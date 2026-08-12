/**
 * Xcode プロジェクトの衝突を解く（tasks.md T-199）。
 *
 * 書き換える前に**必ず差分を見せて確認を取る**。プロジェクトファイルを壊すと
 * Xcode が開かなくなり、そこから戻すのは重い。
 */
import * as vscode from 'vscode';
import { describeResult, resolvePbxproj } from './core/pbxprojConflict';

export async function resolveXcodeConflict(): Promise<void> {
	const uris = await vscode.workspace.findFiles('**/*.pbxproj', '**/{Pods,build}/**', 5);
	if (uris.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: `project.pbxproj` が見つかりません。');
		return;
	}

	const target = uris.length === 1
		? uris[0]
		: (await vscode.window.showQuickPick(
			uris.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
			{ title: 'Nimbus: どのプロジェクトファイルを解きますか' }
		))?.uri;
	if (!target) {
		return;
	}

	const document = await vscode.workspace.openTextDocument(target);
	const result = resolvePbxproj(document.getText());
	if (!result.content) {
		void vscode.window.showWarningMessage(`Nimbus: ${describeResult(result)}`);
		return;
	}

	// 直す前に、何がどう変わるのかを見せる。承認と同じ考え方（実ファイルはまだ変えない）
	const preview = await vscode.workspace.openTextDocument({ content: result.content, language: 'plaintext' });
	await vscode.commands.executeCommand(
		'vscode.diff',
		target,
		preview.uri,
		`${vscode.workspace.asRelativePath(target)}（解いた結果）`
	);

	const apply = '適用する';
	const answer = await vscode.window.showInformationMessage(describeResult(result), { modal: true }, apply);
	if (answer !== apply) {
		return;
	}

	const edit = new vscode.WorkspaceEdit();
	edit.replace(target, new vscode.Range(0, 0, document.lineCount, 0), result.content);
	await vscode.workspace.applyEdit(edit);
	await vscode.workspace.save(target);
	void vscode.window.showInformationMessage('Nimbus: 解いた結果を保存しました。Xcode で開いて確かめてください。');
}
