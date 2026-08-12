/**
 * PR のレビュー指摘をセッションに取り込む（tasks.md T-116）。
 *
 * `gh` で指摘を取り、`file:line` と差分を添えてコックピットへ渡す。返信の下書きも作る。
 * **送信はしない** — 返信は人が読んでから出す。
 *
 * 整えかたの本体は `core/prReview.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import {
	describeComment,
	fixPrompt,
	openComments,
	parseReviewComments,
	replyPrompt,
	type ReviewComment
} from './core/prReview';

const run = promisify(execFile);

async function gh(args: string[], cwd: string): Promise<string> {
	const { stdout } = await run('gh', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
	return stdout;
}

/** いまのブランチの PR 番号。無ければ undefined */
async function currentPrNumber(cwd: string): Promise<number | undefined> {
	try {
		const out = await gh(['pr', 'view', '--json', 'number'], cwd);
		const parsed = JSON.parse(out) as { number?: unknown };
		return typeof parsed.number === 'number' ? parsed.number : undefined;
	} catch {
		return undefined;
	}
}

export async function importPrReview(send: (text: string) => void): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const cwd = folder.uri.fsPath;

	let number = await currentPrNumber(cwd);
	if (number === undefined) {
		const typed = await vscode.window.showInputBox({
			title: 'Nimbus: PR の番号',
			prompt: 'このブランチに紐づく PR が見つかりませんでした。番号を入れてください',
			validateInput: (value) => (/^\d+$/.test(value.trim()) ? undefined : '数字で入れてください')
		});
		if (!typed) {
			return;
		}
		number = Number(typed.trim());
	}

	let comments: ReviewComment[];
	try {
		const out = await gh(
			['api', `repos/{owner}/{repo}/pulls/${number}/comments`, '--paginate'],
			cwd
		);
		comments = openComments(parseReviewComments(JSON.parse(out)));
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		void vscode.window.showErrorMessage(
			message.includes('ENOENT')
				? 'Nimbus: gh コマンドが見つかりません（GitHub CLI を入れて `gh auth login` してください）。'
				: `Nimbus: レビューを取得できませんでした: ${message}`
		);
		return;
	}

	if (comments.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: PR #${number} に未対応のレビュー指摘はありません。`);
		return;
	}

	const ALL = `$(checklist) ${comments.length} 件すべてを直してもらう`;
	const items: (vscode.QuickPickItem & { comment?: ReviewComment })[] = [
		{ label: ALL },
		...comments.map((comment) => ({
			label: describeComment(comment),
			detail: `${comment.author} — 選ぶと返信の下書きを作ります`,
			comment
		}))
	];
	const picked = await vscode.window.showQuickPick(items, {
		title: `Nimbus: PR #${number} のレビュー指摘（${comments.length} 件）`
	});
	if (!picked) {
		return;
	}

	if (picked.label === ALL) {
		send(fixPrompt(comments));
		return;
	}
	if (!picked.comment) {
		return;
	}
	const done = await vscode.window.showInputBox({
		title: 'Nimbus: この指摘に対してやったこと',
		prompt: '返信の下書きに使います。まだ何もしていなければ空のままで構いません',
		placeHolder: '例: null チェックを足しました'
	});
	// Esc は取りやめ。空文字は「まだ何もしていない」として通す
	if (done === undefined) {
		return;
	}
	send(replyPrompt(picked.comment, done));
}
