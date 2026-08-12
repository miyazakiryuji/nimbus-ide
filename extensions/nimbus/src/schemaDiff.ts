/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { diffSchemas, parseSchema, renderMigration } from './core/schemaDiff';
import { pickWorkspaceRoot } from './workspaceRoots';

interface GitRepository {
	rootUri: vscode.Uri;
	show(ref: string, path: string): Promise<string>;
}

interface GitApi {
	repositories: GitRepository[];
}

/** スキーマの前の版を Git から取る。取れなければ空（すべて新規として扱う） */
async function readFromHead(file: vscode.Uri): Promise<string> {
	const extension = vscode.extensions.getExtension<{ getAPI(version: 1): GitApi }>('vscode.git');
	if (!extension) {
		return '';
	}
	const api = (await extension.activate()).getAPI(1);
	const repository = api.repositories.find((candidate) => file.fsPath.startsWith(candidate.rootUri.fsPath));
	try {
		return (await repository?.show('HEAD', file.fsPath)) ?? '';
	} catch {
		return '';
	}
}

/**
 * 直したスキーマと、Git に入っている版を見比べてマイグレーションを起こす。
 *
 * **走らせはしない。** 出すのは手順だけで、流すかどうかは人が決める。
 */
export async function openMigrationPlan(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const found = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*.sql'),
		'**/node_modules/**',
		200
	);
	if (found.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: スキーマファイル（`.sql`）が見つかりません。');
		return;
	}

	const picked = found.length === 1
		? found[0]
		: (await vscode.window.showQuickPick(
			found.map((file) => ({ label: vscode.workspace.asRelativePath(file, false), file })),
			{ title: '見比べるスキーマを選ぶ' }
		))?.file;
	if (!picked) {
		return;
	}

	const after = new TextDecoder().decode(await vscode.workspace.fs.readFile(picked));
	const before = await readFromHead(picked);
	if (before.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 前の版を Git から取れませんでした。すべて新規として扱います。');
	}

	const document = await vscode.workspace.openTextDocument({
		language: 'markdown',
		content: renderMigration(diffSchemas(parseSchema(before), parseSchema(after)))
	});
	await vscode.window.showTextDocument(document, { preview: true });
}
