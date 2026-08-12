/**
 * リリースノートの下書きを開く（tasks.md T-062）。
 *
 * 範囲は「直近のタグ → HEAD」を既定にする。タグが無ければ `HEAD~20` から。
 * 文章を書くのは人（または本文をセッションに渡す）。ここは事実を並べるところまで。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { groupCommits, parseCommitLog, renderReleaseNotes } from './core/releaseNotes';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim())
		);
	});
}

export async function draftReleaseNotes(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const lastTag = await git(['describe', '--tags', '--abbrev=0'], root);
	const from = await vscode.window.showInputBox({
		title: 'Nimbus: リリースノートの下書き',
		prompt: 'どこからの変更をまとめますか（タグ・ブランチ・コミット）',
		value: lastTag ?? 'HEAD~20',
		validateInput: (value) => (value.trim().length === 0 ? '空にはできません' : undefined)
	});
	if (!from) {
		return;
	}

	const log = await git(['log', '--format=%h%x09%s', `${from.trim()}..HEAD`], root);
	if (log === undefined) {
		void vscode.window.showInformationMessage(`Nimbus: \`${from.trim()}\` からの履歴を読めませんでした。`);
		return;
	}

	const markdown = renderReleaseNotes(groupCommits(parseCommitLog(log)), from.trim(), 'HEAD');
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
