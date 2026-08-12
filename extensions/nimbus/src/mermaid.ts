/**
 * Mermaid の図を確かめる（tasks.md T-061）。
 *
 * 見るのは開いている Markdown。**描画は VS Code のプレビューに任せる**
 * （レンダラを同梱すると重いうえ、本家より良くはならない）。
 */
import * as vscode from 'vscode';
import { checkMermaid, extractMermaidBlocks, renderMermaidReport } from './core/mermaid';

export async function checkMermaidDiagrams(): Promise<void> {
	const document = vscode.window.activeTextEditor?.document;
	if (!document || document.languageId !== 'markdown') {
		void vscode.window.showInformationMessage('Nimbus: Markdown を開いてから実行してください。');
		return;
	}

	const blocks = extractMermaidBlocks(document.getText());
	const problems = blocks.flatMap((block) => checkMermaid(block));

	if (blocks.length > 0 && problems.length === 0) {
		// 問題が無いなら、報告より先に図を見せたほうが早い
		await vscode.commands.executeCommand('markdown.showPreviewToSide');
		void vscode.window.showInformationMessage(
			`Nimbus: ${blocks.length} 個の図に、よくある間違いはありませんでした。`
		);
		return;
	}

	const report = await vscode.workspace.openTextDocument({
		content: renderMermaidReport(blocks, problems),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(report, { preview: false, viewColumn: vscode.ViewColumn.Beside });
}
