/**
 * 命名のゆれとそっくりな実装を見せる（tasks.md T-178 / T-137）。
 *
 * 見るのはワークスペースのソース。**直すのは人**なので、ここは一覧を出すところまで。
 */
import * as vscode from 'vscode';
import { findDuplicateBlocks, findNamingIssues, renderCodeHealth } from './core/codeHealth';
import { findDeadExports, renderDeadExports } from './core/deadCode';
import { findLayerViolations, rankComplexity, renderStructure } from './core/structure';
import { findDeadReferences, findParamMismatches, renderCommentFindings } from './core/commentCheck';
import { isExampleFile, renderVulnFindings, scanSource } from './core/vulnScan';

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
	// 層の逆流は先に出す。約束を破っているものは、読みにくさより先に直したい（T-138）
	// コメントだけが古い場所も同じ面に出す（T-210）。読む人は本文よりコメントを信じる
	const paths = files.map((file) => file.path);
	const comments = files.flatMap((file) => [
		...findParamMismatches(file.path, file.content),
		...findDeadReferences(file.path, file.content, paths)
	]);
	// 危ない書き方はいちばん上に出す（T-202）。読みにくさより先に見たい
	const vulns = files
		.filter((file) => !isExampleFile(file.path))
		.flatMap((file) => scanSource(file.path, file.content));
	const markdown = [
		renderVulnFindings(vulns),
		renderStructure(rankComplexity(files), findLayerViolations(files)),
		renderCommentFindings(comments),
		renderCodeHealth(findNamingIssues(names), findDuplicateBlocks(files)),
		renderDeadExports(findDeadExports(files))
	]
		.filter(Boolean)
		.join('\n');
	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
