/**
 * 脆弱性の警告を、直す順番にして開く（tasks.md T-121）。
 *
 * **直す操作はしない。** `npm audit fix` は人が打つ。ここは順番を決めるところまで。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { parseAudit, planFixes, renderFixPlan } from './core/vulnFix';

function npmAudit(cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile(
			'npm',
			['audit', '--json'],
			{ cwd, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
			// 脆弱性があると終了コードが 1 になるので、エラーでも出力を読む
			(error, stdout) => resolve(stdout && stdout.trim().length > 0 ? stdout : error ? undefined : stdout)
		);
	});
}

export async function openVulnFixPlan(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const json = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: npm audit を実行しています' },
		async () => npmAudit(root)
	);
	if (!json) {
		void vscode.window.showInformationMessage('Nimbus: `npm audit` を実行できませんでした（npm が無い／依存が入っていない）。');
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: renderFixPlan(planFixes(parseAudit(json))),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
