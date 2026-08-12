/**
 * 公開 API を変えたのに古いままの文書を見つける（tasks.md T-209）。
 *
 * 差分レビューでは気づけない — **変わっていないファイルは差分に出ない**。
 * だから「変えた名前に触れているのに、今回の変更に含まれていない文書」を機械が挙げる。
 *
 * 判定と文面は `core/apiDocs.ts`。ここは git と VS Code の口だけ。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import {
	buildDocUpdatePrompt,
	changedExports,
	describeStaleDocs,
	findStaleDocs,
	type DocFile
} from './core/apiDocs';

/** 見る文書の数。多すぎると読み込みだけで時間を使う */
const MAX_DOCS = 200;
const DOC_GLOB = '**/*.md';
const EXCLUDE = '**/{node_modules,.git,out,dist,build,.dart_tool,target,vendor,.venv}/**';

export interface ApiDocsDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

/** 変えた公開名に触れている文書を挙げ、確かめてから直させる */
export async function checkApiDocs(deps: ApiDocsDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri;

	let diff: string;
	let changedFiles: string[];
	try {
		diff = await git(root.fsPath, ['diff', 'HEAD']);
		changedFiles = (await git(root.fsPath, ['diff', '--name-only', 'HEAD']))
			.split('\n')
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
	} catch (error) {
		deps.log(`[apidocs] 差分を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の差分を取得できませんでした。');
		return;
	}

	const symbols = changedExports(diff);
	if (symbols.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 公開している名前の変更は見つかりませんでした。');
		return;
	}

	const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, DOC_GLOB), EXCLUDE, MAX_DOCS);
	const docs: DocFile[] = [];
	for (const file of files) {
		try {
			docs.push({
				path: file.path.slice(root.path.length + 1),
				text: new TextDecoder().decode(await vscode.workspace.fs.readFile(file))
			});
		} catch {
			// 読めない文書は飛ばす
		}
	}

	const stale = findStaleDocs(symbols, changedFiles, docs);
	const summary = describeStaleDocs(stale);
	deps.log(`[apidocs] ${summary.split('\n')[0]}`);
	if (stale.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const SEND = '確かめさせる';
	const choice = await vscode.window.showWarningMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		SEND
	);
	if (choice === SEND) {
		deps.send(buildDocUpdatePrompt(stale));
	}
}
