/**
 * 「この変更、何を壊す？」を適用の前に見せる（tasks.md T-158）。
 *
 * `git diff HEAD` から**消した／変えた export** を拾い、その名前をまだ呼んでいる場所を
 * ワークスペースから探して並べる。型チェックが教えてくれるのは同じ言語の中だけで、
 * しかも直したあとにしか出ない。ここは先に見せる。
 *
 * 判断の本体は `core/impact.ts`（VS Code 非依存・単体テスト済み）。
 */
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { apiChanges, summarizeDiff } from './core/diffSummary';
import { assessImpact, formatImpact } from './core/impact';

const run = promisify(execFile);

/** 探索対象。生成物や依存は見ない（当たっても直す先ではない） */
const SEARCH = '**/*.{ts,tsx,js,jsx,mjs,cjs,dart,go,py,rs,swift,kt,java}';
const IGNORE = '**/{node_modules,out,out-build,out-vscode,.build,dist,build,.git}/**';
/** 一度に読むファイル数の上限。巨大なリポジトリで固まらせない */
const MAX_FILES = 3000;

export async function showImpact(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	let diff: string;
	try {
		const { stdout } = await run('git', ['diff', 'HEAD'], {
			cwd: folder.uri.fsPath,
			maxBuffer: 64 * 1024 * 1024
		});
		diff = stdout;
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Nimbus: 差分を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
		);
		return;
	}

	const summaries = summarizeDiff(diff);
	// 消したものと、消えて足された（＝形が変わった）ものが対象
	const symbols = apiChanges(summaries)
		.filter((symbol) => symbol.change === 'removed')
		.map((symbol) => ({ name: symbol.name, kind: symbol.kind, change: 'removed' as const }));
	if (symbols.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 消した・変えた export はありません。');
		return;
	}

	const changedPaths = new Set(summaries.map((file) => file.path));
	const files = new Map<string, string>();
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: 呼び出し元を探しています', cancellable: true },
		async (_progress, token) => {
			const uris = await vscode.workspace.findFiles(SEARCH, IGNORE, MAX_FILES, token);
			for (const uri of uris) {
				if (token.isCancellationRequested) {
					return;
				}
				try {
					const bytes = await vscode.workspace.fs.readFile(uri);
					files.set(vscode.workspace.asRelativePath(uri, false), Buffer.from(bytes).toString('utf8'));
				} catch {
					// 読めないファイルは飛ばす（バイナリ・権限）
				}
			}
		}
	);

	const impacted = assessImpact({ symbols, files, changedPaths });
	const document = await vscode.workspace.openTextDocument({
		content: formatImpact(impacted),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
