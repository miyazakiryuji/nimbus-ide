/**
 * 指示の出しかたを見る（tasks.md T-065 / T-067）。
 *
 * 材料は記録（`~/.claude/projects`）。読むだけで、どこにも書き込まない。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import { collectPrompts, renderPromptStats, summarizePrompts } from './core/promptStats';
import { findFrictionSpots, renderFrictionSpots } from './core/frictionSpots';
import { readRecentTranscripts } from './core/transcriptFiles';

/** 傾向を見るので、ふりかえりより多めに読む */
const MAX_TRANSCRIPTS = 60;
const MAX_BYTES = 8 * 1024 * 1024;

export async function openPromptStats(home: string = homedir()): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const entries = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 記録を読んでいます' },
		async () => readRecentTranscripts(root, home, { limit: MAX_TRANSCRIPTS, maxBytes: MAX_BYTES })
	);

	// 詰まりやすい場所も同じ面に出す（T-066）。傾向と場所は一緒に見たほうが手が動く
	const samples = collectPrompts(entries);
	const content = renderPromptStats(summarizePrompts(samples)) + '\n' + renderFrictionSpots(findFrictionSpots(samples));
	const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
