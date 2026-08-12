/**
 * やり取りを切り出す（tasks.md T-214）。
 *
 * 材料は記録（`~/.claude/projects`）。読むだけで、どこにも書き込まない。
 * 出すのはエディタまで — **ファイルに保存しない**（配るかどうかは人が決める）。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import { pickHighlights, renderHighlights } from './core/highlights';
import { readRecentTranscripts } from './core/transcriptFiles';

const MAX_TRANSCRIPTS = 30;
const MAX_BYTES = 8 * 1024 * 1024;

export async function openHighlights(home: string = homedir()): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const entries = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 記録を読んでいます' },
		async () => readRecentTranscripts(root, home, { limit: MAX_TRANSCRIPTS, maxBytes: MAX_BYTES })
	);

	const document = await vscode.workspace.openTextDocument({
		content: renderHighlights(pickHighlights(entries, home)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
