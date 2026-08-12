/**
 * 作業ブランチの離れ具合を開く（tasks.md T-134 / T-219）。
 *
 * 比べる先は、既定で `main`（無ければ `master`）。
 * 「両側で同じファイルを触っているか」を見たいので、双方の変更ファイル一覧を取る。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { overlappingFiles, parseAheadBehind, renderBranchHealth } from './core/branchHealth';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim())
		);
	});
}

/**
 * 比べる先を決める。
 *
 * 設定があればそれを使う。**フォークでは `main` が upstream になっていることがあり**、
 * そのままだと「688 コミット遅れている」のような、比べても意味の無い数字が出る
 * （このリポジトリで実際に出た）。
 */
async function pickBase(root: string): Promise<string | undefined> {
	const configured = vscode.workspace.getConfiguration('nimbus').get<string>('git.baseBranch');
	if (configured && (await git(['rev-parse', '--verify', configured], root))) {
		return configured;
	}
	for (const candidate of ['main', 'master']) {
		if (await git(['rev-parse', '--verify', candidate], root)) {
			return candidate;
		}
	}
	return undefined;
}

export async function openBranchHealth(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], root);
	if (!branch) {
		void vscode.window.showInformationMessage('Nimbus: git の情報を読めませんでした。');
		return;
	}

	const base = await pickBase(root);
	if (!base || base === branch) {
		void vscode.window.showInformationMessage(
			base ? `Nimbus: いま \`${base}\` にいます。作業ブランチで実行してください。` : 'Nimbus: 比べる先（main / master）が見つかりません。'
		);
		return;
	}

	const counts = parseAheadBehind((await git(['rev-list', '--left-right', '--count', `${base}...HEAD`], root)) ?? '');
	const ours = ((await git(['diff', '--name-only', `${base}...HEAD`], root)) ?? '').split('\n').filter(Boolean);
	const theirs = ((await git(['diff', '--name-only', `HEAD...${base}`], root)) ?? '').split('\n').filter(Boolean);

	const markdown = renderBranchHealth(branch, base, {
		...counts,
		overlapping: overlappingFiles(ours, theirs)
	});

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
