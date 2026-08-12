/**
 * 設定のパッケージ配布（tasks.md T-043）の入出力。
 *
 * `.claude/` の中身のうち**配ってよいもの**だけを 1 枚の JSON にまとめ、読み込む。
 * ZIP ではなく JSON にしてあるのは、中身が読めて差分が取れるほうが
 * 「何を配られたのか」が分かるため。
 */
import * as vscode from 'vscode';
import {
	buildBundle,
	BUNDLED_DIRECTORIES,
	BUNDLED_FILES,
	describePlan,
	isBundlable,
	parseBundle,
	planApply,
	type BundleFile
} from './core/bundle';

function claudeDir(): vscode.Uri | undefined {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	return root ? vscode.Uri.joinPath(root, '.claude') : undefined;
}

/** `.claude/` を歩いて、配れるファイルだけを集める */
async function collectFiles(base: vscode.Uri, relative = ''): Promise<BundleFile[]> {
	const files: BundleFile[] = [];
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(base, relative));
	} catch {
		return files;
	}
	for (const [name, type] of entries) {
		const path = relative ? `${relative}/${name}` : name;
		if (type === vscode.FileType.Directory) {
			files.push(...(await collectFiles(base, path)));
			continue;
		}
		if (type !== vscode.FileType.File || !isBundlable(path)) {
			continue;
		}
		try {
			const content = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(base, path))).toString('utf8');
			files.push({ path, content });
		} catch {
			continue;
		}
	}
	return files;
}

/**
 * まとめて配る（T-043）。
 * **秘匿情報が混ざっていないかは、書き出す前に検査する** — 配ってからでは戻せない。
 */
export async function exportBundle(
	detectSecrets: (text: string) => { label: string }[],
	log: (message: string) => void
): Promise<void> {
	const dir = claudeDir();
	if (!dir) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
		return;
	}
	const files: BundleFile[] = [];
	for (const top of [...BUNDLED_DIRECTORIES, ...BUNDLED_FILES]) {
		files.push(...(await collectFiles(dir, top)));
	}
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 配れるものが見つかりませんでした（.claude/skills などに置きます）。');
		return;
	}

	// 名前で弾いただけでは、本文に書かれた資格情報は止まらない
	const risky = files.filter((file) => detectSecrets(file.content).length > 0);
	if (risky.length > 0) {
		const CONTINUE = 'それでも書き出す';
		const answer = await vscode.window.showWarningMessage(
			`Nimbus: ${risky.length} 件のファイルに資格情報らしき文字列があります。`,
			{ modal: true, detail: risky.map((file) => `・${file.path}`).join('\n') },
			CONTINUE
		);
		if (answer !== CONTINUE) {
			return;
		}
	}

	const name = await vscode.window.showInputBox({ title: 'Nimbus: 配布物の名前', placeHolder: '例: チーム共通の設定' });
	if (!name) {
		return;
	}
	const description = await vscode.window.showInputBox({ title: '説明（任意）' });
	const target = await vscode.window.showSaveDialog({
		title: '配布物の保存先',
		filters: { 'Nimbus 配布物': ['json'] },
		saveLabel: '書き出す'
	});
	if (!target) {
		return;
	}
	const bundle = buildBundle(name, description ?? '', files, new Date());
	await vscode.workspace.fs.writeFile(target, Buffer.from(`${JSON.stringify(bundle, null, 2)}\n`, 'utf8'));
	log(`[bundle] ${bundle.files.length} 件を書き出しました: ${target.fsPath}`);
	void vscode.window.showInformationMessage(`Nimbus: ${bundle.files.length} 件を書き出しました。`);
}

/** 配られたものを読み込む（T-043）。**既存と違うものは黙って上書きしない** */
export async function importBundle(log: (message: string) => void): Promise<void> {
	const dir = claudeDir();
	if (!dir) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてください。');
		return;
	}
	const picked = await vscode.window.showOpenDialog({
		title: '読み込む配布物',
		canSelectMany: false,
		filters: { 'Nimbus 配布物': ['json'] }
	});
	if (!picked || picked.length === 0) {
		return;
	}
	const text = Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8');
	const check = parseBundle(text);
	if (!check.ok) {
		void vscode.window.showErrorMessage(`Nimbus: 読み込めません — ${check.reason}`);
		return;
	}

	// いまあるものを読んでから比べる
	const existing = new Map<string, string>();
	for (const file of check.bundle.files) {
		try {
			existing.set(
				file.path,
				Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, file.path))).toString('utf8')
			);
		} catch {
			// 無いものは追加になる
		}
	}
	const plan = planApply(check.bundle, existing);
	const ADD_ONLY = '新規だけ入れる';
	const ALL = 'すべて入れる（上書きあり）';
	const choices = plan.conflicting.length > 0 ? [ADD_ONLY, ALL] : [ADD_ONLY];
	const answer = await vscode.window.showWarningMessage(
		`Nimbus: 「${check.bundle.name}」を読み込みます（${describePlan(plan)}）。`,
		{
			modal: true,
			detail:
				plan.conflicting.length > 0
					? `次のファイルは中身が違います:\n${plan.conflicting.map((file) => `・${file.path}`).join('\n')}`
					: undefined
		},
		...choices
	);
	if (!answer) {
		return;
	}
	const targets = answer === ALL ? [...plan.added, ...plan.conflicting] : plan.added;
	for (const file of targets) {
		const uri = vscode.Uri.joinPath(dir, file.path);
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf8'));
	}
	log(`[bundle] ${targets.length} 件を展開しました（${check.bundle.name}）`);
	void vscode.window.showInformationMessage(`Nimbus: ${targets.length} 件を入れました。`);
}


/**
 * チーム設定の同期（tasks.md T-049）。
 *
 * T-043 は「書き出して手で配る」。こちらは**リポジトリに置いたものを取り込む**形で、
 * 配る側が更新したら、次に開いた人が気づける。
 *
 * 置き場所は既定で `.claude/team-bundle.json`。**リポジトリにコミットされている前提**なので、
 * 誰がいつ何を変えたかは Git が持っている（Nimbus が履歴を持つ必要がない）。
 */
export async function syncTeamBundle(log: (message: string) => void, quiet: boolean): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri;
	const dir = claudeDir();
	if (!root || !dir) {
		return;
	}
	const relative =
		vscode.workspace.getConfiguration('nimbus').get<string>('team.bundlePath') || '.claude/team-bundle.json';
	const bundleUri = vscode.Uri.joinPath(root, relative);
	let text: string;
	try {
		text = Buffer.from(await vscode.workspace.fs.readFile(bundleUri)).toString('utf8');
	} catch {
		if (!quiet) {
			void vscode.window.showInformationMessage(`Nimbus: ${relative} がありません（チーム設定は配られていません）。`);
		}
		return;
	}
	const check = parseBundle(text);
	if (!check.ok) {
		// 起動時の確認では黙らない。壊れた配布物に気づけないほうが困る
		void vscode.window.showWarningMessage(`Nimbus: ${relative} を読めません — ${check.reason}`);
		return;
	}

	const existing = new Map<string, string>();
	for (const file of check.bundle.files) {
		try {
			existing.set(
				file.path,
				Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(dir, file.path))).toString('utf8')
			);
		} catch {
			// 無いものは追加になる
		}
	}
	const plan = planApply(check.bundle, existing);
	if (plan.added.length === 0 && plan.conflicting.length === 0) {
		if (!quiet) {
			void vscode.window.showInformationMessage('Nimbus: チーム設定は最新です。');
		}
		return;
	}

	const APPLY = plan.conflicting.length > 0 ? '取り込む（上書きあり）' : '取り込む';
	const answer = await vscode.window.showInformationMessage(
		`Nimbus: チーム設定「${check.bundle.name}」に差分があります（${describePlan(plan)}）。`,
		APPLY
	);
	if (answer !== APPLY) {
		return;
	}
	for (const file of [...plan.added, ...plan.conflicting]) {
		const uri = vscode.Uri.joinPath(dir, file.path);
		await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
		await vscode.workspace.fs.writeFile(uri, Buffer.from(file.content, 'utf8'));
	}
	log(`[team] ${plan.added.length + plan.conflicting.length} 件を取り込みました（${check.bundle.name}）`);
	void vscode.window.showInformationMessage('Nimbus: チーム設定を取り込みました。');
}
