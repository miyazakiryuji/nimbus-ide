/**
 * 「このコードはなぜこうなっているのか」を辿る（tasks.md T-079）。
 *
 * コードを読んでも分からないことは、`git blame` が知っている。
 * いつ・誰が・どのコミットで入れたのか、そこに書かれた意図ごとエージェントに渡す。
 *
 * 解析と文面は `core/archaeology.ts`。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import {
	buildArchaeologyPrompt,
	describeCommit,
	groupByCommit,
	parseBlamePorcelain
} from './core/archaeology';
import { resolveWorkspaceRoot } from './workspaceRoots';
import { isNotebookCell, notebookNotSupported } from './core/notebooks';

export interface ArchaeologyDeps {
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

/** 選択範囲（無ければカーソル行）の由来を調べ、経緯ごと渡す */
export async function exploreHistory(deps: ArchaeologyDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const folder = editor ? resolveWorkspaceRoot(editor.document.uri) : undefined;
	if (!editor || !folder) {
		void vscode.window.showInformationMessage('Nimbus: 調べたい範囲を開いてから実行してください。');
		return;
	}
	// セルは git の管理単位ではない（T-174）
	if (isNotebookCell(editor.document.uri.scheme)) {
		void vscode.window.showInformationMessage(`Nimbus: ${notebookNotSupported('履歴を辿る機能')}`);
		return;
	}
	const root = folder.uri.fsPath;
	const file = displayPath([root], editor.document.uri.fsPath);
	const selection = editor.selection;
	const startLine = selection.start.line + 1;
	const endLine = (selection.isEmpty ? selection.active.line : selection.end.line) + 1;

	let output: string;
	try {
		output = await git(root, [
			'blame',
			`-L${startLine},${endLine}`,
			'--line-porcelain',
			'--',
			file
		]);
	} catch (error) {
		deps.log(`[history] blame できませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git blame を実行できませんでした（未コミットのファイルかもしれません）。');
		return;
	}

	const groups = groupByCommit(parseBlamePorcelain(output));
	if (groups.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: この範囲の履歴が見つかりませんでした。');
		return;
	}
	deps.log(`[history] ${file}:${startLine}–${endLine} は ${groups.length} コミット由来`);

	const ASK = 'なぜこうなっているかを調べさせる';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${file}:${startLine}–${endLine} は ${groups.length} コミット由来です。`,
		{ detail: groups.map(describeCommit).join('\n'), modal: false },
		ASK
	);
	if (choice === ASK) {
		const code = editor.document.getText(
			new vscode.Range(startLine - 1, 0, endLine - 1, Number.MAX_SAFE_INTEGER)
		);
		deps.send(buildArchaeologyPrompt(file, startLine, endLine, groups, code));
	}
}
