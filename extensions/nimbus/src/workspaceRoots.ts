/**
 * どのワークスペースフォルダを対象にするかを決める（tasks.md T-173）。
 *
 * 各機能はこの 2 つだけを使えばよい:
 *   - `resolveWorkspaceRoot(hint?)` — **聞かずに決める**（手がかりがあるとき・フォルダが 1 つのとき）
 *   - `pickWorkspaceRoot()` — 決まらないときだけ聞く（フォルダが 1 つなら即返す）
 *
 * 「フォルダが 1 つなら何も聞かない」が要件。コミット前や競合の最中に毎回
 * ダイアログが出ると、道具として使えなくなる。
 */
import * as vscode from 'vscode';
import { needsPicking, rootFor } from './core/workspaceRoots';

function asRoots(): { name: string; path: string; folder: vscode.WorkspaceFolder }[] {
	return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
		name: folder.name,
		path: folder.uri.fsPath,
		folder
	}));
}

/**
 * 聞かずに決める。
 * 手がかり（対象のファイル）があればそれを含むフォルダ、無ければ
 * いま開いているエディタのファイル、それも無ければ最初のフォルダ。
 */
export function resolveWorkspaceRoot(hint?: vscode.Uri): vscode.WorkspaceFolder | undefined {
	const roots = asRoots();
	if (roots.length === 0) {
		return undefined;
	}
	const target = hint?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
	const found = rootFor(roots, target);
	return (found as { folder?: vscode.WorkspaceFolder } | undefined)?.folder ?? roots[0].folder;
}

/**
 * 決まらないときだけ聞く。
 * **フォルダが 1 つなら即座に返す**（聞くのは 2 つ以上で、手がかりでも決まらないときだけ）。
 */
export async function pickWorkspaceRoot(hint?: vscode.Uri): Promise<vscode.WorkspaceFolder | undefined> {
	const roots = asRoots();
	if (roots.length === 0) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてから実行してください。');
		return undefined;
	}
	const target = hint?.fsPath ?? vscode.window.activeTextEditor?.document.uri.fsPath;
	if (!needsPicking(roots, target)) {
		return resolveWorkspaceRoot(hint);
	}
	const picked = await vscode.window.showQuickPick(
		roots.map((root) => ({ label: root.name, description: root.path, folder: root.folder })),
		{ title: 'Nimbus: どのフォルダを対象にしますか', placeHolder: '複数のフォルダが開かれています' }
	);
	return picked?.folder;
}
