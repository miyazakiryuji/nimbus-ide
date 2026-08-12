/**
 * いまの変更のようすを開く（tasks.md T-159 / T-082）。
 *
 * 見るのは「HEAD といまの作業ツリーの差」。staged / unstaged の両方を含める
 * （どちらに入っているかは、レビューの前段では気にしなくていい）。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { parseNumstat, renderChangeStats, summarize } from './core/changeStats';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout)
		);
	});
}

export async function openChangeStats(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const numstat = await git(['diff', 'HEAD', '--numstat'], root);
	if (numstat === undefined) {
		void vscode.window.showInformationMessage('Nimbus: git の履歴を読めませんでした（git 管理下ではありません）。');
		return;
	}

	const markdown = renderChangeStats(summarize(parseNumstat(numstat)));
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}
