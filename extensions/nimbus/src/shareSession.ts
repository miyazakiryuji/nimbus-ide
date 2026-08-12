/**
 * セッションを人に見せられる形にする（tasks.md T-048）。
 *
 * **どこにもアップロードしない。** 作るのは 1 枚のファイルまでで、
 * 渡すかどうか・どこへ渡すかは人が決める。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { buildShareDocument, inspectRedactions } from './core/shareSession';
import { readRecentTranscripts } from './core/transcriptFiles';

const MAX_TRANSCRIPTS = 2;
const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TURNS = 10;

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout)
		);
	});
}

export async function shareSession(home: string = homedir()): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const entries = await readRecentTranscripts(root, home, { limit: MAX_TRANSCRIPTS, maxBytes: MAX_BYTES });
	if (entries.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 見せられる記録がありません。');
		return;
	}

	const question = await vscode.window.showInputBox({
		title: 'Nimbus: 何を見てほしいですか',
		prompt: '空のままでも作れます（あとから書けます）',
		placeHolder: '例: この直しで承認が 2 回出るのはなぜか'
	});

	const withDiff = await vscode.window.showQuickPick(
		[
			{ label: 'やり取りだけ', value: false },
			{ label: 'いまの差分も添える', value: true }
		],
		{ title: 'Nimbus: 差分を添えますか' }
	);
	if (!withDiff) {
		return;
	}

	const diff = withDiff.value ? await git(['diff', 'HEAD'], root) : undefined;

	// 何が伏せられるかを、作る前に見せる
	const source = entries.map((entry) => entry.text).join('\n') + (diff ?? '');
	const report = inspectRedactions(source, home);
	if (report.count > 0) {
		const proceed = '作る';
		const answer = await vscode.window.showWarningMessage(
			`Nimbus: ${report.count} 箇所を伏せます（${report.kinds.join(' / ')}）。それ以外はそのまま載ります。`,
			{ modal: true },
			proceed
		);
		if (answer !== proceed) {
			return;
		}
	}

	const content = buildShareDocument(entries, { home, diff, question, turns: DEFAULT_TURNS });
	const document = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
	void vscode.window.showInformationMessage(
		'Nimbus: 共有用の 1 枚を作りました。どこにも送っていません — 渡す前に中身を確かめてください。'
	);
}
