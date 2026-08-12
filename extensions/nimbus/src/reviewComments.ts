/**
 * レビューコメントを取り込む（tasks.md T-116）。
 *
 * 取り込み元は `gh`（GitHub CLI）。**無ければ諦める**（Nimbus は GitHub の API を
 * 自分で叩かない — 資格情報を持たない方針）。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { classifyAll, renderComments, toPrompt, toWorkList, type ReviewComment } from './core/reviewComments';

function gh(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout)
		);
	});
}

/** `gh pr view --json comments,reviews` の出力を、扱いやすい形にする */
function parse(json: string): ReviewComment[] {
	try {
		const data = JSON.parse(json) as {
			comments?: { author?: { login?: string }; body?: string; url?: string }[];
			reviews?: { author?: { login?: string }; body?: string; url?: string }[];
		};
		return [...(data.comments ?? []), ...(data.reviews ?? [])]
			.filter((entry) => (entry.body ?? '').trim().length > 0)
			.map((entry) => ({
				author: entry.author?.login ?? '(不明)',
				body: (entry.body ?? '').trim(),
				url: entry.url
			}));
	} catch {
		return [];
	}
}

export async function importReviewComments(send: (text: string) => void): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const json = await gh(['pr', 'view', '--json', 'comments,reviews'], root);
	if (json === undefined) {
		void vscode.window.showInformationMessage(
			'Nimbus: `gh pr view` を実行できませんでした（GitHub CLI が無い／PR が無い／認証されていない）。'
		);
		return;
	}

	const comments = classifyAll(parse(json));
	if (comments.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: コメントが見つかりませんでした。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: renderComments(comments),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });

	const work = toWorkList(comments);
	if (work.length === 0) {
		return;
	}

	const picked = await vscode.window.showQuickPick(
		work.map((comment) => ({
			label: comment.body.split('\n')[0].slice(0, 60),
			description: comment.path ? `${comment.path}${comment.line ? `:${comment.line}` : ''}` : comment.author,
			comment
		})),
		{ title: 'Nimbus: どれから直しますか（1 件ずつ渡します）' }
	);
	if (picked) {
		// まとめて渡すと、どれに対する修正か分からなくなる。1 件ずつ
		send(toPrompt(picked.comment));
	}
}
