/**
 * いまのようすを見る（tasks.md T-089 / T-053）。
 *
 * 起点は「Nimbus を開いた時刻」。セッションをまたいで数えると、寝ている間まで
 * 「続けている」ことになってしまう。
 */
import * as vscode from 'vscode';
import { renderRhythm } from './core/rhythm';

const START_KEY = 'nimbus.rhythmStartedAt';
const SUGGESTED_KEY = 'nimbus.rhythmSuggestedAt';

export async function openRhythm(
	context: vscode.ExtensionContext,
	counts: () => { running: number; pending: number }
): Promise<void> {
	const now = Date.now();
	const startedAt = context.workspaceState.get<number>(START_KEY) ?? now;
	if (context.workspaceState.get<number>(START_KEY) === undefined) {
		await context.workspaceState.update(START_KEY, now);
	}

	const { running, pending } = counts();
	const input = {
		startedAt,
		now,
		lastSuggestedAt: context.workspaceState.get<number>(SUGGESTED_KEY),
		running,
		pending
	};

	const markdown = renderRhythm(input);
	// 見せた時点で「すすめた」ことにする。次にまた同じことを言わないため
	await context.workspaceState.update(SUGGESTED_KEY, now);

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
