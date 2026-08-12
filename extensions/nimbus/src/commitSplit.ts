/**
 * 「このコミット、分けたほうがいい？」に答える（tasks.md T-114）。
 *
 * 作業ツリーの変更を意図ごとに束ね、束ごとの `git add -- …` まで出した一枚を開く。
 * 判断はしない — 束ねて見せるだけで、どれを 1 つのコミットにするかは人が決める。
 *
 * 束ねかたの本体は `core/commitSplit.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { formatPlan, groupChanges, parseStatus } from './core/commitSplit';

const run = promisify(execFile);

export async function proposeCommitSplit(): Promise<void> {
	// マルチルート対応（T-173）。コミットの分けかたは、そのフォルダの git に対して出す。
	// フォルダが 1 つなら何も聞かない
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	let porcelain: string;
	try {
		// シェルを通さない。パスに空白や記号が入っても壊れないようにするため
		const { stdout } = await run('git', ['status', '--porcelain', '--untracked-files=all'], {
			cwd,
			maxBuffer: 8 * 1024 * 1024
		});
		porcelain = stdout;
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Nimbus: git の状態を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
		);
		return;
	}

	const files = parseStatus(porcelain);
	if (files.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 変更はありません。');
		return;
	}

	const groups = groupChanges(files);
	const document = await vscode.workspace.openTextDocument({
		content: formatPlan(groups),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
