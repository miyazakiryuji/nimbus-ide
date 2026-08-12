/**
 * 選択範囲をスニペットとして保存する（tasks.md T-177）。
 *
 * 一度うまく書けた形を**エディタ側に置く**。次からは補完で出るので、
 * 同じ形をエージェントに書かせ直さずに済む。
 *
 * 保存先はワークスペースの `.vscode/<language>.code-snippets`。
 * リポジトリに入るので、そのままチームで共有できる。
 */
import * as vscode from 'vscode';
import { buildSnippet, mergeSnippets, snippetFileName } from './core/snippets';

export interface SnippetsDeps {
	log: (message: string) => void;
}

/** いまの選択範囲をスニペットにする */
export async function saveSelectionAsSnippet(deps: SnippetsDeps): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!editor || !folder) {
		void vscode.window.showInformationMessage('Nimbus: 保存したい範囲を選んでから実行してください。');
		return;
	}
	const code = editor.document.getText(editor.selection);
	if (code.trim().length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 範囲を選んでから実行してください。');
		return;
	}

	const name = await vscode.window.showInputBox({
		title: 'Nimbus: スニペットとして保存',
		prompt: 'このパターンの名前',
		placeHolder: '例: Riverpod の非同期プロバイダ'
	});
	if (!name) {
		return;
	}
	const prefix = await vscode.window.showInputBox({
		title: 'Nimbus: スニペットとして保存',
		prompt: '補完で打つ言葉（prefix）',
		placeHolder: '例: asyncprov'
	});
	if (!prefix) {
		return;
	}

	const file = vscode.Uri.joinPath(folder.uri, '.vscode', snippetFileName(editor.document.languageId));
	let existing = '';
	try {
		existing = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
	} catch {
		// 無ければ新規作成
	}
	const { text, replaced } = mergeSnippets(existing, buildSnippet(name, prefix, code, `Nimbus: ${name}`));
	await vscode.workspace.fs.writeFile(file, new TextEncoder().encode(text));
	deps.log(`[snippet] ${replaced ? '上書き' : '追加'}: ${name} (${prefix})`);

	const OPEN = '開く';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: スニペット「${name}」を${replaced ? '上書きしました' : '保存しました'}（\`${prefix}\` で出ます）。`,
		OPEN
	);
	if (choice === OPEN) {
		await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
	}
}
