/**
 * CI が落ちた実行のログを取りに行く（tasks.md T-131）。
 *
 * 赤くなってから人がログを開くまでが、いちばん無駄な時間。
 * **取りに行って、原因の当たりをつけるところまで**を先にやる。
 *
 * 取得は `gh` CLI に任せる（認証を自前で持たない）。無ければ、その旨を伝えて終わる。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { buildCiPrompt, describeRun, latestFailure, parseRunList, type CiRun } from './core/ciFailure';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface CiFailureDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function run(cwd: string, command: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

/** 落ちた CI のログを取り、切り分けを頼む */
export async function investigateCi(deps: CiFailureDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	try {
		await run(cwd, 'gh', ['--version']);
	} catch {
		void vscode.window.showInformationMessage(
			'Nimbus: gh コマンドが見つかりません（GitHub CLI を入れて `gh auth login` を済ませると使えます）。'
		);
		return;
	}

	let runs: CiRun[];
	try {
		const json = await run(cwd, 'gh', [
			'run',
			'list',
			'--limit',
			'10',
			'--json',
			'databaseId,workflowName,status,conclusion,headBranch,createdAt'
		]);
		runs = parseRunList(json);
	} catch (error) {
		deps.log(`[ci] 一覧を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: CI の実行一覧を取得できませんでした。');
		return;
	}

	const failed = latestFailure(runs);
	if (!failed) {
		void vscode.window.showInformationMessage('Nimbus: 落ちている CI はありません。');
		return;
	}

	// どの実行を見るかは選べるようにする（直近が本命とは限らない）
	const picked = await vscode.window.showQuickPick(
		runs.map((entry) => ({ label: describeRun(entry), entry, picked: entry.id === failed.id })),
		{ title: 'Nimbus: どの実行を調べますか', placeHolder: `既定: ${describeRun(failed)}` }
	);
	const target = picked?.entry ?? failed;

	let log = '';
	try {
		log = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 失敗ログを取得しています' },
			() => run(cwd, 'gh', ['run', 'view', String(target.id), '--log-failed'])
		);
	} catch (error) {
		// ログが取れなくても、どの実行が落ちたかは渡せる
		deps.log(`[ci] ログを取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
	}

	deps.log(`[ci] ${describeRun(target)} を調べます`);
	const SEND = '原因を調べさせる';
	const choice = await vscode.window.showWarningMessage(
		`Nimbus: ${describeRun(target)}`,
		{ detail: log.length > 0 ? '失敗ログを添えて投入します。' : 'ログは取得できませんでした（実行の情報だけを渡します）。', modal: false },
		SEND
	);
	if (choice === SEND) {
		deps.send(buildCiPrompt(target, log));
	}
}
