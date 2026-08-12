/**
 * レビューを頼む文を作る（tasks.md T-211）。
 *
 * 作ったらクリップボードへ入れる。**送るのは人**（どこへ送るかは Nimbus が決めることではない）。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { parseNumstat, summarize } from './core/changeStats';
import { renderReviewRequest } from './core/reviewRequest';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim())
		);
	});
}

export async function draftReviewRequest(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], root)) ?? '';
	const configured = vscode.workspace.getConfiguration('nimbus').get<string>('git.baseBranch');
	let base = configured && (await git(['rev-parse', '--verify', configured], root)) ? configured : undefined;
	for (const candidate of ['main', 'master']) {
		if (!base && (await git(['rev-parse', '--verify', candidate], root))) {
			base = candidate;
		}
	}
	if (!branch || !base) {
		void vscode.window.showInformationMessage('Nimbus: git の情報を読めませんでした。');
		return;
	}

	const intent = await vscode.window.showInputBox({
		title: 'Nimbus: レビューを頼む',
		prompt: '何のための変更か（1 行で。空でも作れます）',
		placeHolder: '例: 課金モードの判定が サブスク で誤表示されていたのを直しました'
	});

	const focus = await vscode.window.showInputBox({
		title: 'Nimbus: とくに見てほしいところ',
		prompt: '無ければ空のままで大丈夫です',
		placeHolder: '例: 境界値の扱い'
	});

	const numstat = (await git(['diff', `${base}...HEAD`, '--numstat'], root)) ?? '';
	const message = renderReviewRequest({
		branch,
		base,
		stats: summarize(parseNumstat(numstat)),
		intent,
		focus
	});

	await vscode.env.clipboard.writeText(message);
	const show = '中身を見る';
	const answer = await vscode.window.showInformationMessage('Nimbus: レビュー依頼の文をコピーしました。', show);
	if (answer === show) {
		const document = await vscode.workspace.openTextDocument({ content: message, language: 'markdown' });
		await vscode.window.showTextDocument(document, { preview: false });
	}
}
