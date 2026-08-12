/**
 * 書いたものを社内 Wiki / Notion に出す（tasks.md T-208）。
 *
 * リポジトリの中にあるうちは、リポジトリを開ける人にしか届かない。
 * そのまま貼ると相対リンクが全部死ぬので、**貼れる形に直すところまで**をやる。
 *
 * **貼るのは人。** どこに出すかはその組織の話で、機械が決めることではない。
 *
 * 判定と文面は `core/wikiExport.ts`。
 */
import { execFile } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { browseUrl, describeExport, toWiki } from './core/wikiExport';

export interface WikiExportDeps {
	log: (message: string) => void;
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

/** いま開いている Markdown を、貼れる形にして写す */
export async function exportToWiki(deps: WikiExportDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || editor.document.languageId !== 'markdown') {
		void vscode.window.showInformationMessage('Nimbus: Markdown のファイルを開いてから実行してください。');
		return;
	}
	const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
	const cwd = folder?.uri.fsPath;

	let repoUrl: string | undefined;
	let ref = 'main';
	if (cwd) {
		try {
			repoUrl = browseUrl(await git(cwd, ['remote', 'get-url', 'origin']));
		} catch {
			// remote が無いリポジトリ。リンクは直せないが、変換自体は進む
		}
		try {
			ref = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main';
		} catch {
			ref = 'main';
		}
	}

	const basePath = cwd
		? path.relative(cwd, editor.document.uri.fsPath).split(path.sep).join('/')
		: undefined;
	const result = toWiki(editor.document.getText(), { repoUrl, ref, basePath });
	const summary = describeExport(result);
	deps.log(`[wiki] ${summary.split('\n')[0]}`);

	const COPY = '写す';
	const OPEN = '開く';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		COPY,
		OPEN
	);
	if (choice === COPY) {
		await vscode.env.clipboard.writeText(result.markdown);
		void vscode.window.showInformationMessage('Nimbus: 写しました（社内 Wiki に貼れます）。');
		return;
	}
	if (choice === OPEN) {
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: result.markdown
		});
		await vscode.window.showTextDocument(document, { preview: false });
	}
}
