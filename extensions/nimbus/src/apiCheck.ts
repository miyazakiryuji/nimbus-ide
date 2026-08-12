/**
 * 実物とスキーマを突き合わせ、仮の応答を作る（tasks.md T-218 / T-124）。
 *
 * 実物は**選択範囲かクリップボード**から取る（curl の結果を貼る使い方を想定）。
 * 仮の応答はエディタに開くだけ。サーバーは立てない — 立てると片付け忘れる。
 */
import * as vscode from 'vscode';
import { buildExample, checkResponse, renderResponseCheck } from './core/apiCheck';
import { parseSchemas, type SchemaModel } from './core/openapi';

async function pickSchemaFile(): Promise<vscode.Uri | undefined> {
	const found = await vscode.workspace.findFiles('**/*{openapi,swagger}*.json', '**/node_modules/**', 10);
	if (found.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: OpenAPI の JSON が見つかりません（YAML は未対応です）。');
		return undefined;
	}
	if (found.length === 1) {
		return found[0];
	}
	return (
		await vscode.window.showQuickPick(
			found.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
			{ title: 'Nimbus: どのスキーマを使いますか' }
		)
	)?.uri;
}

async function pickModel(models: readonly SchemaModel[]): Promise<SchemaModel | undefined> {
	const usable = models.filter((model) => !model.unsupported);
	if (usable.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 使える定義がありません。');
		return undefined;
	}
	return (
		await vscode.window.showQuickPick(
			usable.map((model) => ({ label: model.name, description: `${model.fields.length} フィールド`, model })),
			{ title: 'Nimbus: どの定義と突き合わせますか' }
		)
	)?.model;
}

async function loadModels(): Promise<SchemaModel[] | undefined> {
	const uri = await pickSchemaFile();
	if (!uri) {
		return undefined;
	}
	try {
		return parseSchemas(JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8')));
	} catch {
		void vscode.window.showWarningMessage('Nimbus: JSON として読めませんでした。');
		return undefined;
	}
}

export async function checkApiResponse(): Promise<void> {
	const models = await loadModels();
	if (!models) {
		return;
	}
	const model = await pickModel(models);
	if (!model) {
		return;
	}

	const editor = vscode.window.activeTextEditor;
	const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
	const text = selected || (await vscode.env.clipboard.readText());
	let response: unknown;
	try {
		response = JSON.parse(text);
	} catch {
		void vscode.window.showInformationMessage('Nimbus: JSON を選択するか、コピーしてから実行してください。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: renderResponseCheck(model, checkResponse(model, response)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}

export async function generateMockResponse(): Promise<void> {
	const models = await loadModels();
	if (!models) {
		return;
	}
	const model = await pickModel(models);
	if (!model) {
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: JSON.stringify(buildExample(model, models), null, 2),
		language: 'json'
	});
	await vscode.window.showTextDocument(document, { preview: false });
	void vscode.window.showInformationMessage('Nimbus: 仮の応答です。値は明らかに仮のものにしてあります。');
}
