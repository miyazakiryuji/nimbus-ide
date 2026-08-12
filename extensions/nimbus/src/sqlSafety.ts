/**
 * SQL を流す前に見る（tasks.md T-126 / T-127）。
 *
 * **DB には繋がない。** 接続情報を持つと、それ自体が事故のもとになる。
 * 見るのは選択範囲か、開いている `.sql` の中身だけ。
 */
import * as vscode from 'vscode';
import { inspect, isReadOnly, renderSqlReport, splitStatements } from './core/sqlSafety';

export async function checkSql(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
	const text = selected || (editor?.document.languageId === 'sql' ? editor.document.getText() : '');
	if (!text.trim()) {
		void vscode.window.showInformationMessage('Nimbus: SQL を選択するか、`.sql` を開いてから実行してください。');
		return;
	}

	const statements = splitStatements(text).map(inspect);
	const document = await vscode.workspace.openTextDocument({
		content: renderSqlReport(statements),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false, viewColumn: vscode.ViewColumn.Beside });

	// 取り返しがつかないものがあるときだけ、目立つ形でも知らせる
	const destructive = statements.filter((statement) => statement.destructive);
	if (destructive.length > 0) {
		void vscode.window.showWarningMessage(
			`Nimbus: 取り返しがつかない操作が ${destructive.length} 件あります。流す前に対象の件数を数えてください。`
		);
	} else if (isReadOnly(statements)) {
		void vscode.window.showInformationMessage('Nimbus: 読み取りだけです。');
	}
}
