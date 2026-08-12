/**
 * 差分を読む前の見取り図を出す（tasks.md T-157）。
 *
 * `git diff HEAD` を構造として要約し、新しいタブに開く。
 * 「意図」までは機械には分からないので、そこは Claude に投げられるようにしてある。
 *
 * 要約の本体は `core/diffSummary.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { formatSummary, intentPrompt, summarizeDiff } from './core/diffSummary';

const run = promisify(execFile);

export async function showDiffSummary(send: (text: string) => void): Promise<void> {
	// マルチルート対応（T-173）。要約はそのフォルダの git diff に対して出す。
	// フォルダが 1 つなら何も聞かない
	const folder = await pickWorkspaceRoot();
	if (!folder) {
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

	const files = summarizeDiff(diff);
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 変更はありません。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: formatSummary(files),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });

	const ASK = '意図の要約を Claude に頼む';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${files.length} ファイルの変更を要約しました。`,
		ASK
	);
	if (choice === ASK) {
		send(intentPrompt(files));
	}
}
