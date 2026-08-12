/**
 * セッションをたどり直す（tasks.md T-206）。
 *
 * 1 枚にまとめて開く。**再生ボタンは付けない** — 実際に待たされても意味がなく、
 * 見たいのは「どこで止まっていたか」だから。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { buildReplay, renderReplay } from './core/replay';
import { readRecentTranscripts } from './core/transcriptFiles';

const MAX_TRANSCRIPTS = 1;
const MAX_BYTES = 8 * 1024 * 1024;

export async function openReplay(home: string = homedir()): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const entries = await readRecentTranscripts(root, home, { limit: MAX_TRANSCRIPTS, maxBytes: MAX_BYTES });
	const steps = buildReplay(entries);
	if (steps.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: たどり直せる記録がありません。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: renderReplay(steps),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
