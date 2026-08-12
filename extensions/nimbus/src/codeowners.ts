/**
 * コードオーナーへの通知（tasks.md T-221）。
 *
 * 触ったファイルに持ち主がいるなら、**誰にレビューを頼むかはもう決まっている**。
 * `CODEOWNERS` を目で追って探すのは人の仕事ではないし、読み違えると別の人に投げてしまう。
 *
 * **こちらからは投げない。** 誰に頼むかを出すところまでで止める
 * （メンションは相手の時間を取るので、送る判断は人が持つ）。
 *
 * 判定と文面は `core/codeowners.ts`。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import {
	describeOwners,
	ownersFor,
	parseCodeowners,
	renderMentionBlock,
	summarizeOwners,
	type OwnerRule
} from './core/codeowners';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface CodeOwnersDeps {
	log: (message: string) => void;
}

/** GitHub が見る順（先に見つかったものが有効） */
const CODEOWNERS_PATHS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS'];

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

async function readCodeowners(root: vscode.Uri): Promise<{ path: string; rules: OwnerRule[] } | undefined> {
	for (const candidate of CODEOWNERS_PATHS) {
		try {
			const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, candidate));
			return { path: candidate, rules: parseCodeowners(new TextDecoder().decode(bytes)) };
		} catch {
			// 次の候補へ
		}
	}
	return undefined;
}

/** 触ったファイル。まだコミットしていないものと、ブランチで積んだものの両方 */
async function changedFiles(cwd: string): Promise<string[]> {
	const files = new Set<string>();
	const working = await git(cwd, ['diff', '--name-only', 'HEAD']);
	for (const line of working.split('\n')) {
		if (line.trim().length > 0) {
			files.add(line.trim());
		}
	}
	if (files.size === 0) {
		// 手元が綺麗なら、ブランチが積んだぶんを見る
		for (const base of ['origin/main', 'origin/master', 'main', 'master']) {
			try {
				const merged = await git(cwd, ['diff', '--name-only', `${base}...HEAD`]);
				for (const line of merged.split('\n')) {
					if (line.trim().length > 0) {
						files.add(line.trim());
					}
				}
				break;
			} catch {
				// その基準は無い。次へ
			}
		}
	}
	return [...files].sort();
}

/** いま開いているファイルの持ち主を、ステータスバーではなく通知で 1 行だけ */
export async function showOwnersOfActiveFile(deps: CodeOwnersDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor) {
		void vscode.window.showInformationMessage('Nimbus: ファイルを開いてから実行してください。');
		return;
	}
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	if (!folder) {
		return;
	}
	const codeowners = await readCodeowners(folder.uri);
	if (!codeowners) {
		void vscode.window.showInformationMessage('Nimbus: CODEOWNERS が見つかりません。');
		return;
	}
	const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
	const owners = ownersFor(relative, codeowners.rules);
	deps.log(`[owners] ${relative}: ${owners.join(', ') || '持ち主なし'}`);
	void vscode.window.showInformationMessage(
		owners.length > 0
			? `Nimbus: ${relative} の持ち主は ${owners.join(', ')} です。`
			: `Nimbus: ${relative} に持ち主はいません（CODEOWNERS に一致しません）。`
	);
}

/** 触ったファイルの持ち主を集め、レビューを頼む相手を出す */
export async function notifyCodeOwners(deps: CodeOwnersDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const codeowners = await readCodeowners(folder.uri);
	if (!codeowners) {
		void vscode.window.showInformationMessage(
			'Nimbus: CODEOWNERS が見つかりません（.github/CODEOWNERS などに置くと使えます）。'
		);
		return;
	}

	let files: string[];
	try {
		files = await changedFiles(folder.uri.fsPath);
	} catch (error) {
		deps.log(`[owners] 差分を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の差分を取得できませんでした。');
		return;
	}
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 触ったファイルはありません。');
		return;
	}

	const summary = summarizeOwners(files, codeowners.rules);
	const description = describeOwners(summary);
	deps.log(`[owners] ${codeowners.path}: ${description.split('\n')[0]}`);
	if (summary.owners.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${description}`);
		return;
	}

	const COPY = '一覧を写す';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${description.split('\n')[0]}`,
		{ detail: description, modal: false },
		COPY
	);
	if (choice === COPY) {
		await vscode.env.clipboard.writeText(renderMentionBlock(summary));
		void vscode.window.showInformationMessage('Nimbus: PR の説明に貼れる形で写しました。');
	}
}
