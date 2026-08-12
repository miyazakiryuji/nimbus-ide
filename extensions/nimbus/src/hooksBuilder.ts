/**
 * Hooks の組み立てとドライラン（tasks.md T-026 / T-161）の UI。
 *
 * 保存先は `.claude/settings.json`。**Nimbus 独自の置き場所は作らない** —
 * Claude Code 本体が読む場所に書かないと、フックとして動かない。
 */
import { spawn } from 'child_process';
import * as vscode from 'vscode';
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

function settingsUri(): vscode.Uri | undefined {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	return root ? vscode.Uri.joinPath(root, '.claude', 'settings.json') : undefined;
}

async function readSettings(uri: vscode.Uri): Promise<Record<string, unknown>> {
	try {
		const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
		return JSON.parse(content) as Record<string, unknown>;
	} catch {
		// 無い・壊れているときは空から始める（既存を消さないよう、書き込み前に必ず読み直す）
		return {};
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
	const uri = settingsUri();
	if (!uri) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
		return;
	}
	const settings = await readSettings(uri);
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
	const uri = settingsUri();
	const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!uri || !cwd) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
		return;
	}
	const config = ((await readSettings(uri))['hooks'] as HooksConfig | undefined) ?? {};
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
