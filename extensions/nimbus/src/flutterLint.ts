/**
 * Flutter の確認を開く（tasks.md T-194 / T-195）。
 *
 * 対象はワークスペースの `.dart`（生成物と `build/` は除く）。
 */
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { lintFlutterSource, renderFlutterLint, type SourceFinding } from './core/flutterLint';

/** 一度に読むファイル数の上限 */
const MAX_FILES = 400;

export async function openFlutterLint(): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const uris = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '**/*.dart'),
		'**/{build,.dart_tool,ios,android,windows,linux,macos}/**',
		MAX_FILES
	);
	if (uris.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: `.dart` が見つかりません（Flutter / Dart のプロジェクトで使えます）。');
		return;
	}

	const findings = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: Dart を読んでいます' },
		async () => {
			const all: SourceFinding[] = [];
			for (const uri of uris) {
				// 生成物は直さないので見ない
				if (/\.(g|freezed)\.dart$/.test(uri.fsPath)) {
					continue;
				}
				try {
					const bytes = await vscode.workspace.fs.readFile(uri);
					all.push(...lintFlutterSource(vscode.workspace.asRelativePath(uri), Buffer.from(bytes).toString('utf8')));
				} catch {
					continue;
				}
			}
			return all;
		}
	);

	const document = await vscode.workspace.openTextDocument({
		content: renderFlutterLint(findings),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
