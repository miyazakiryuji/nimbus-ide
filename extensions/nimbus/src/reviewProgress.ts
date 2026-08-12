/**
 * レビューの進みを見る・印を付ける（tasks.md T-160）。
 *
 * 対象は「いまの変更」（`git diff HEAD`）。印はワークスペースに持つので、
 * 閉じて開き直しても続きから見られる。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import {
	markReviewed,
	prune,
	renderProgress,
	statusFor,
	unmark,
	type ReviewState
} from './core/reviewProgress';

const STATE_KEY = 'nimbus.reviewProgress';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => resolve(error ? undefined : stdout));
	});
}

async function changedFiles(root: string): Promise<{ path: string; content: string }[]> {
	const names = ((await git(['diff', 'HEAD', '--name-only'], root)) ?? '').split('\n').filter(Boolean);
	const files: { path: string; content: string }[] = [];
	for (const name of names) {
		// 中身そのものではなく、そのファイルの差分を指紋の元にする。
		// 別の場所が変わっただけで「見直し」にしない
		const diff = (await git(['diff', 'HEAD', '--', name], root)) ?? '';
		files.push({ path: name, content: diff });
	}
	return files;
}

export async function openReviewProgress(context: vscode.ExtensionContext): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const files = await changedFiles(root);
	let state = context.workspaceState.get<ReviewState>(STATE_KEY) ?? { marks: [] };
	state = prune(state, files.map((file) => file.path));
	await context.workspaceState.update(STATE_KEY, state);

	const statuses = statusFor(state, files);
	const picked = await vscode.window.showQuickPick(
		[
			{ label: '$(list-unordered) 進みを見る', action: 'show' as const, path: '' },
			...statuses.map((status) => ({
				label: `${status.changedSinceReview ? '$(sync)' : status.reviewed ? '$(check)' : '$(circle-large-outline)'} ${status.path}`,
				description: status.changedSinceReview ? '見たあとに変わりました' : status.reviewed ? '見ました' : undefined,
				action: (status.reviewed ? 'unmark' : 'mark') as 'mark' | 'unmark',
				path: status.path
			}))
		],
		{ title: 'Nimbus: レビューの進み', placeHolder: `${statuses.filter((s) => s.reviewed).length} / ${statuses.length} 見ました` }
	);
	if (!picked) {
		return;
	}

	if (picked.action === 'show') {
		const document = await vscode.workspace.openTextDocument({
			content: renderProgress(statuses),
			language: 'markdown'
		});
		await vscode.window.showTextDocument(document, { preview: false });
		return;
	}

	const file = files.find((entry) => entry.path === picked.path);
	const next = picked.action === 'mark' && file
		? markReviewed(state, picked.path, file.content, Date.now())
		: unmark(state, picked.path);
	await context.workspaceState.update(STATE_KEY, next);

	// 印を付けたら、その差分をそのまま開く（見ながら進められるように）
	if (picked.action === 'mark') {
		const uri = vscode.Uri.joinPath(vscode.Uri.file(root), picked.path);
		await vscode.commands.executeCommand('vscode.open', uri);
	}
}
