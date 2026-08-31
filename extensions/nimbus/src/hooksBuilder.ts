/**
 * Hooks の組み立てとドライラン（tasks.md T-026 / T-161）の UI。
 *
 * 保存先は `.claude/settings.json`。**Nimbus 独自の置き場所は作らない** —
 * Claude Code 本体が読む場所に書かないと、フックとして動かない。
 */
import { spawn } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import {
	addHook,
	ALL_HOOK_EVENTS,
	COMMON_HOOK_EVENTS,
	dryRunPayload,
	flattenHooks,
	HOOK_EVENT_HELP,
	interpretExitCode,
	removeHook,
	usesMatcher,
	type HookEventName,
	type HooksConfig
} from './core/hooks';

/** ドライランの待ち上限。返らないフックで画面を止めない */
const DRY_RUN_TIMEOUT_MS = 30_000;

/**
 * どのルートの `settings.json` かは**呼ぶ側が決める**（T-173）。
 * 先頭のルートに決め打つと、複数フォルダのときに
 * 別のフォルダのフックを書き換えてしまう。
 */
function settingsUri(root: vscode.Uri): vscode.Uri {
	return vscode.Uri.joinPath(root, '.claude', 'settings.json');
}

/**
 * `settings.json` を読んだ結果（T-352）。
 * 「読めた（無いので空を含む）」と「在るのに読めない」を**呼ぶ側に区別させる**ための形。
 */
type SettingsRead =
	| { readonly ok: true; readonly settings: Record<string, unknown> }
	| { readonly ok: false; readonly reason: string };

/**
 * 読めなかった理由を日本語で返す。**「まだ無い」だけは失敗にしない**（`undefined` を返す）—
 * 初回はそこから新しく作るのが正しい（T-352）。
 *
 * `workspace.fs` は errno を `FileSystemError.code`（FileNotFound / NoPermissions …）へ
 * 畳んでから投げる。素の errno で来る経路もあるので両方を見る。
 * **分からない失敗は「読めた」ことにしない** — 書き潰すより、止まって理由を見せるほうが安い。
 */
function readFailureReason(error: unknown): string | undefined {
	const code = (error as { code?: string } | null | undefined)?.code;
	if (code === 'FileNotFound' || code === 'ENOENT') {
		return undefined;
	}
	if (code === 'NoPermissions' || code === 'EACCES' || code === 'EPERM') {
		return '読み取りの権限がありません';
	}
	if (code === 'FileIsADirectory' || code === 'EISDIR') {
		return 'ファイルではなくフォルダになっています';
	}
	return error instanceof Error ? error.message : String(error);
}

/**
 * 書き込み前に必ず読み直す。**読めなかったことを、空だったことにしない**（T-352）。
 *
 * 以前は readFile の失敗と JSON.parse の失敗を同じ catch で `{}` にしていた。
 * mode 222（書けるが読めない）だと書き込みだけ成功するので、読めなかった 1 回で
 * 利用者の `permissions` / `env` が黙って消えた。画面でしか出ない壊れかたなので、
 * 敵対ケース `nimbus/tests/gui/cases/adv-08-unreadable-settings.mjs` が現物で押さえている。
 */
async function readSettings(uri: vscode.Uri): Promise<SettingsRead> {
	let content: string;
	try {
		content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	} catch (error) {
		const reason = readFailureReason(error);
		return reason === undefined ? { ok: true, settings: {} } : { ok: false, reason };
	}
	try {
		return { ok: true, settings: JSON.parse(content) as Record<string, unknown> };
	} catch {
		// 壊れた JSON は空から始める（意図して決めてある振る舞い。T-352 でも変えない）
		return { ok: true, settings: {} };
	}
}

/**
 * 読めなかったことを伝える（T-352）。
 *
 * **ボタンを 1 つ添えるのは飾りではない。** VS Code はボタンの無いエラー通知を 15 秒で消す
 * （`src/vs/workbench/browser/parts/notifications/notificationsToasts.ts` の PURGE_TIMEOUT と、
 * `src/vs/workbench/common/notifications.ts` の `get sticky()`）。
 * 「保存しませんでした」は、消えたら**利用者が保存できたと思い込む**知らせなので居座らせる。
 * 押されたら、権限を直すのに要るパスを渡す — 直すのは端末側の仕事なので、貼れる形が早い。
 */
async function reportUnreadable(uri: vscode.Uri, message: string): Promise<void> {
	const COPY = 'パスをコピー';
	if ((await vscode.window.showErrorMessage(message, COPY)) === COPY) {
		await vscode.env.clipboard.writeText(uri.fsPath);
	}
}

/** イベントを選ばせる。**よく使う 5 つを先に**、残りは「すべて表示」の先へ */
async function pickEvent(): Promise<HookEventName | undefined> {
	const MORE = '$(ellipsis) すべてのイベントを表示（31 種類）';
	const common = COMMON_HOOK_EVENTS.map((event) => ({
		label: event,
		description: HOOK_EVENT_HELP[event] ?? '',
		event: event as HookEventName | undefined
	}));
	const first = await vscode.window.showQuickPick([...common, { label: MORE, description: '', event: undefined }], {
		title: 'Nimbus: どのタイミングで走らせますか'
	});
	if (!first) {
		return undefined;
	}
	if (first.event) {
		return first.event;
	}
	const all = await vscode.window.showQuickPick(
		ALL_HOOK_EVENTS.map((event) => ({ label: event, description: HOOK_EVENT_HELP[event] ?? '' })),
		{ title: 'Nimbus: フックイベント（31 種類）' }
	);
	return all?.label as HookEventName | undefined;
}

/** フックの一覧と、追加・削除（T-026） */
export async function manageHooks(log: (message: string) => void): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const uri = settingsUri(folder.uri);
	const read = await readSettings(uri);
	if (!read.ok) {
		// 読めないまま書くと、既存の設定を空とみなして丸ごと消す（T-352）。書かずに理由を言う
		log(`[hooks] settings.json を読めないので中止しました: ${read.reason}`);
		await reportUnreadable(
			uri,
			`Nimbus: .claude/settings.json を読めないので、フックを保存しませんでした（${read.reason}）。` +
			'中身を消さないよう、何も書いていません。権限を直してからやり直してください。'
		);
		return;
	}
	const settings = read.settings;
	const config = (settings['hooks'] as HooksConfig | undefined) ?? {};
	const rows = flattenHooks(config);

	const ADD = '$(add) フックを足す';
	const OPEN = '$(json) settings.json を開く';
	const chosen = await vscode.window.showQuickPick(
		[
			{ label: ADD, description: '', row: undefined },
			...rows.map((row) => ({
				label: row.command,
				description: [row.event, row.matcher].filter(Boolean).join(' · '),
				row
			})),
			{ label: OPEN, description: '', row: undefined }
		],
		{ title: `Nimbus: フック（${rows.length} 件・選ぶと削除）`, matchOnDescription: true }
	);
	if (!chosen) {
		return;
	}
	if (chosen.label === OPEN) {
		await vscode.window.showTextDocument(uri);
		return;
	}
	if (chosen.label === ADD) {
		const event = await pickEvent();
		if (!event) {
			return;
		}
		const matcher = usesMatcher(event)
			? await vscode.window.showInputBox({
				title: `Nimbus: ${event} — どのツールに効かせますか`,
				prompt: '正規表現。空なら全部のツール',
				placeHolder: '例: Bash|Write'
			})
			: undefined;
		if (usesMatcher(event) && matcher === undefined) {
			return;
		}
		const command = await vscode.window.showInputBox({
			title: `Nimbus: ${event} で走らせるコマンド`,
			prompt: '標準入力に JSON が渡ります。終了コード 2 で止められます',
			placeHolder: "例: jq -e '.tool_input.command | test(\"rm -rf\") | not'"
		});
		if (!command) {
			return;
		}
		const next = addHook(config, event, matcher, command);
		await writeHooks(uri, settings, next);
		log(`[hooks] ${event} に足しました: ${command}`);
		void vscode.window.showInformationMessage(
			'Nimbus: フックを保存しました。次のセッションから効きます（ドライランで先に試せます）。'
		);
		return;
	}
	if (chosen.row) {
		const next = removeHook(config, chosen.row.event, chosen.row.matcherIndex, chosen.row.hookIndex);
		await writeHooks(uri, settings, next);
		log(`[hooks] ${chosen.row.event} から外しました: ${chosen.row.command}`);
	}
}

/** 既存の設定を保ったまま hooks だけ差し替える（他の設定を巻き込まない） */
async function writeHooks(uri: vscode.Uri, settings: Record<string, unknown>, hooks: HooksConfig): Promise<void> {
	const next = { ...settings };
	if (Object.keys(hooks).length === 0) {
		delete next['hooks'];
	} else {
		next['hooks'] = hooks;
	}
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
	await vscode.workspace.fs.writeFile(uri, Buffer.from(`${JSON.stringify(next, null, 2)}\n`, 'utf8'));
}

/**
 * フックのドライラン（T-161）。
 * **本番と同じ形の JSON** を標準入力へ渡して、通すか止めるかを先に確かめる。
 */
export async function dryRunHook(log: (message: string) => void): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const uri = settingsUri(folder.uri);
	// フックは選んだルートで走らせる。別のルートで走らせると結果が変わる
	const cwd = folder.uri.fsPath;
	const read = await readSettings(uri);
	if (!read.ok) {
		// 読めないのに「試せるフックがありません」と言うと、無いのだと信じさせてしまう（T-352）
		await reportUnreadable(
			uri,
			`Nimbus: .claude/settings.json を読めないので、フックを取り出せません（${read.reason}）。` +
			'権限を直してからやり直してください。'
		);
		return;
	}
	const config = (read.settings['hooks'] as HooksConfig | undefined) ?? {};
	const rows = flattenHooks(config);
	if (rows.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 試せるフックがありません。');
		return;
	}
	const chosen = await vscode.window.showQuickPick(
		rows.map((row) => ({
			label: row.command,
			description: [row.event, row.matcher].filter(Boolean).join(' · '),
			row
		})),
		{ title: 'Nimbus: どのフックを試しますか' }
	);
	if (!chosen) {
		return;
	}

	const payload = dryRunPayload(chosen.row.event, cwd);
	const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
		// 利用者が設定に書いたコマンドなので shell を通す
		const child = spawn(chosen.row.command, { cwd, shell: true });
		let stdout = '';
		let stderr = '';
		const timer = setTimeout(() => {
			child.kill();
			resolve({ code: -1, stdout, stderr: `${stderr}\n（${DRY_RUN_TIMEOUT_MS / 1000} 秒で打ち切りました）` });
		}, DRY_RUN_TIMEOUT_MS);
		child.stdout?.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
		child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ code: -1, stdout, stderr: `${stderr}\n${error.message}` });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code: code ?? -1, stdout, stderr });
		});
		child.stdin?.end(payload);
	});

	const verdict = interpretExitCode(result.code);
	log(`[hooks] ドライラン ${chosen.row.event}: ${verdict.label}`);
	const report = [
		`# フックのドライラン`,
		'',
		`- イベント: \`${chosen.row.event}\``,
		chosen.row.matcher ? `- matcher: \`${chosen.row.matcher}\`` : '',
		`- コマンド: \`${chosen.row.command}\``,
		`- 結果: **${verdict.label}**`,
		'',
		'## 渡した入力（本番と同じ形）',
		'',
		'```json',
		payload,
		'```',
		'',
		'## stdout',
		'',
		'```',
		result.stdout.trim() || '（なし）',
		'```',
		'',
		'## stderr',
		'',
		'```',
		result.stderr.trim() || '（なし）',
		'```'
	]
		.filter((line) => line !== '')
		.join('\n');
	const document = await vscode.workspace.openTextDocument({ content: report, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: true });
}
