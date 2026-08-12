/**
 * 監視ツールの障害をセッションに投入する（tasks.md T-142）。
 *
 * Sentry などの JSON を貼ると、**影響の大きさ**と**落ちるまでの足あと**を出し、
 * そのまま「まず再現するテストを書く」ところへ繋ぐ。
 *
 * 読み取りの本体は `core/errorMonitor.ts`（VS Code 非依存・単体テスト済み）。
 */
import * as vscode from 'vscode';
import { fixPrompt, formatIssue, parseMonitoredIssue } from './core/errorMonitor';

export async function importMonitoredIssue(send: (text: string) => void): Promise<void> {
	const document = await vscode.workspace.openTextDocument({
		content: [
			'# 監視ツールの障害',
			'',
			'Sentry などの issue の JSON をここに貼って、タブを閉じずに「貼りました」を押してください。',
			'',
			'`gh` のように取ってくる口は用意していません（認証と設定を持ち込むほどの差が無いため）。',
			'ブラウザの issue 画面から JSON をコピーするか、API の応答をそのまま貼れば読めます。',
			''
		].join('\n'),
		language: 'json'
	});
	await vscode.window.showTextDocument(document, { preview: false });
	const OK = '貼りました';
	if ((await vscode.window.showInformationMessage('Nimbus: JSON を貼ったら押してください。', { modal: true }, OK)) !== OK) {
		return;
	}

	const issue = parseMonitoredIssue(document.getText());
	if (!issue) {
		void vscode.window.showWarningMessage(
			'Nimbus: JSON として読み取れませんでした（issue の JSON をそのまま貼ってください）。'
		);
		return;
	}

	const summary = await vscode.workspace.openTextDocument({ content: formatIssue(issue), language: 'markdown' });
	await vscode.window.showTextDocument(summary, { preview: false });

	const ASK = 'Claude に再現を頼む';
	if ((await vscode.window.showInformationMessage(`Nimbus: ${issue.title}`, ASK)) === ASK) {
		send(fixPrompt(issue));
	}
}
