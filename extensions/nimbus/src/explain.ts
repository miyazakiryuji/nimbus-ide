/**
 * 何をしたのかを開く（tasks.md T-045）。
 *
 * 直近の記録から並べ直す。**いま走っているセッションには割り込まない**
 * （説明のために止めるのは本末転倒）。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { buildExplanation, renderExplanation } from './core/explain';
import { readRecentTranscripts } from './core/transcriptFiles';

const MAX_TRANSCRIPTS = 3;
const MAX_BYTES = 8 * 1024 * 1024;

export async function openExplanation(home: string = homedir()): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const entries = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 記録を読んでいます' },
		async () => readRecentTranscripts(root, home, { limit: MAX_TRANSCRIPTS, maxBytes: MAX_BYTES })
	);

	const document = await vscode.workspace.openTextDocument({
		content: renderExplanation(buildExplanation(entries)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
