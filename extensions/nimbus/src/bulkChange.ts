/**
 * 大規模な一括変更の段取り（tasks.md T-110）。
 *
 * 「このライブラリの破壊的変更に追従して」を丸ごと投げると、レビューできない差分ができる。
 * **影響範囲を先に数え、まとまりに分けて、間にテストを挟ませる。**
 *
 * 残りの数え上げは [refactor-progress](../../../nimbus/docs/specs/refactor-progress.md) に任せる。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { buildMigrationPrompt, describeMigration } from './core/bulkChange';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface BulkChangeDeps {
	send: (text: string) => void;
	log: (message: string) => void;
	/** 置き換えの進捗として追いかけ始める（T-111） */
	track: (pattern: string, label: string) => Promise<void>;
}

function gitGrepFiles(cwd: string, pattern: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		execFile('git', ['grep', '-l', '-I', '-F', '--', pattern], { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
			// 一致なしは exit 1。エラーにしない
			if (error && stdout.length === 0 && (error as { code?: number }).code !== 1) {
				reject(error);
				return;
			}
			resolve(
				stdout
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line.length > 0)
			);
		});
	});
}

/** 追従の段取りを作り、そのまま進捗の追跡も始められるようにする */
export async function planBulkChange(deps: BulkChangeDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const target = await vscode.window.showInputBox({
		title: 'Nimbus: 一括変更の段取りを作る',
		prompt: '追従する対象（パッケージ名や API 名。そのまま検索します）',
		placeHolder: '例: package:provider/  /  useOldApi('
	});
	if (!target) {
		return;
	}

	let files: string[];
	try {
		files = await gitGrepFiles(folder.uri.fsPath, target);
	} catch (error) {
		deps.log(`[bulk] 数えられませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git grep で数えられませんでした。');
		return;
	}

	const note = await vscode.window.showInputBox({
		title: 'Nimbus: 一括変更の段取りを作る',
		prompt: '分かっている変更点があれば（空でも進めます）',
		placeHolder: '例: Provider.of は context.watch に変わった'
	});

	const input = { target, files, note: note || undefined };
	const summary = describeMigration(input);
	deps.log(`[bulk] ${summary.split('\n')[0]}`);
	if (files.length === 0) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const SEND = '段取りを渡す';
	const TRACK = '段取りを渡して進捗も追う';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		SEND,
		TRACK
	);
	if (choice !== SEND && choice !== TRACK) {
		return;
	}
	deps.send(buildMigrationPrompt(input));
	if (choice === TRACK) {
		// 正規表現として渡すのでメタ文字を落とす
		await deps.track(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), `${target} への追従`);
	}
}
