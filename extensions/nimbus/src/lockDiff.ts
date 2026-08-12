/**
 * ロックファイルの差分を読める形で開く（tasks.md T-119）。
 *
 * 比べるのは「いまの中身」と「HEAD の中身」。`git show HEAD:<path>` で取る。
 * git が無い・追跡されていないファイルなら、その旨を出して終わる（黙って空を見せない）。
 */
import { execFile } from 'child_process';
import { basename, relative } from 'path';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { diffLocks, parseLock, renderLockDiff } from './core/lockDiff';

const SUPPORTED = ['pubspec.lock', 'package-lock.json'];

function gitShow(repoRoot: string, revisionPath: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			'git',
			['show', revisionPath],
			{ cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 },
			(error, stdout) => resolve(error ? undefined : stdout)
		);
	});
}

/**
 * いま開いているロックファイルの差分を説明する。
 * 対象が開かれていないときは、ワークスペースから探して選ばせる。
 */
export async function explainLockDiff(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	let target = vscode.window.activeTextEditor?.document.uri;
	if (!target || !SUPPORTED.some((name) => target?.fsPath.endsWith(name))) {
		const found = await vscode.workspace.findFiles(`**/{${SUPPORTED.join(',')}}`, '**/node_modules/**', 20);
		if (found.length === 0) {
			void vscode.window.showInformationMessage(
				`Nimbus: 対応しているロックファイルが見つかりません（${SUPPORTED.join(' / ')}）。`
			);
			return;
		}
		const picked = found.length === 1
			? found[0]
			: (await vscode.window.showQuickPick(
				found.map((uri) => ({ label: relative(root, uri.fsPath), uri })),
				{ title: 'Nimbus: どのロックファイルを見ますか' }
			))?.uri;
		if (!picked) {
			return;
		}
		target = picked;
	}

	const path = relative(root, target.fsPath);
	const head = await gitShow(root, `HEAD:${path}`);
	if (head === undefined) {
		void vscode.window.showInformationMessage(
			`Nimbus: HEAD の ${path} を読めませんでした（git 管理下にない、または新しく追加されたファイルです）。`
		);
		return;
	}

	const current = (await vscode.workspace.openTextDocument(target)).getText();
	const name = basename(path);
	const diff = diffLocks(parseLock(name, head), parseLock(name, current));
	const markdown = renderLockDiff(diff, path);

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}
