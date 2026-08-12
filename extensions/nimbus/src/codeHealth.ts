/**
 * 命名のゆれとそっくりな実装を見せる（tasks.md T-178 / T-137）。
 *
 * 見るのはワークスペースのソース。**直すのは人**なので、ここは一覧を出すところまで。
 */
import * as vscode from 'vscode';
import { findDuplicateBlocks, findNamingIssues, renderCodeHealth } from './core/codeHealth';
import { findDeadExports, renderDeadExports } from './core/deadCode';

/** 一度に読むファイル数の上限（大きなリポジトリで固まらせない） */
const MAX_FILES = 400;

/** 宣言されている名前を拾う。構文解析はしない（言語ごとに書くと保守できない） */
const DECLARATION = /\b(?:function|const|let|var|class|def|fn|func)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

export async function openCodeHealth(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0];
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(root, '**/*.{ts,tsx,js,jsx,dart,go,py,java,kt,swift}'),
		'**/{node_modules,out,dist,build,.dart_tool,vendor}/**',
		MAX_FILES
	);
	if (uris.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 対象のソースが見つかりませんでした。');
		return;
	}

	const files = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: ソースを読んでいます' },
		async () => {
			const loaded: { path: string; content: string }[] = [];
			for (const uri of uris) {
				try {
					const bytes = await vscode.workspace.fs.readFile(uri);
					loaded.push({
						path: vscode.workspace.asRelativePath(uri),
						content: Buffer.from(bytes).toString('utf8')
					});
				} catch {
					continue;
				}
			}
			return loaded;
		}
	);

	const names: string[] = [];
	for (const file of files) {
		for (const match of file.content.matchAll(DECLARATION)) {
			names.push(match[1]);
		}
	}

	// 使われていない export も同じ面に出す（T-112）。どれも「増えていること」を見せる話なので、
	// コマンドを分けるより 1 枚にまとめたほうが読まれる
	const markdown =
		renderCodeHealth(findNamingIssues(names), findDuplicateBlocks(files)) + '\n' + renderDeadExports(findDeadExports(files));
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
