/**
 * スキーマから型を起こす（tasks.md T-122）。
 *
 * 読むのは JSON のスキーマだけ。**YAML は読まない**（パーサを持ち込まないため）。
 * 出力はエディタに開くだけで、ファイルには書かない — 命名と null の扱いは人が決める。
 */
import * as vscode from 'vscode';
import { parseSchemas, renderModels } from './core/openapi';

export async function generateFromSchema(): Promise<void> {
	const found = await vscode.workspace.findFiles('**/*{openapi,swagger}*.json', '**/node_modules/**', 10);
	const active = vscode.window.activeTextEditor?.document;
	const candidates = active?.fileName.endsWith('.json') ? [active.uri, ...found] : found;

	if (candidates.length === 0) {
		void vscode.window.showInformationMessage(
			'Nimbus: OpenAPI の JSON が見つかりません（YAML は未対応です）。開いてから実行することもできます。'
		);
		return;
	}

	const picked = candidates.length === 1
		? candidates[0]
		: (await vscode.window.showQuickPick(
			candidates.map((uri) => ({ label: vscode.workspace.asRelativePath(uri), uri })),
			{ title: 'Nimbus: どのスキーマから起こしますか' }
		))?.uri;
	if (!picked) {
		return;
	}

	const language = await vscode.window.showQuickPick(
		[
			{ label: 'Dart（Flutter）', value: 'dart' as const },
			{ label: 'TypeScript', value: 'typescript' as const }
		],
		{ title: 'Nimbus: どちらで起こしますか' }
	);
	if (!language) {
		return;
	}

	let document: unknown;
	try {
		document = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(picked)).toString('utf8'));
	} catch {
		void vscode.window.showWarningMessage('Nimbus: JSON として読めませんでした。');
		return;
	}

	const output = await vscode.workspace.openTextDocument({
		content: renderModels(parseSchemas(document), language.value),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(output, { preview: false });
}
