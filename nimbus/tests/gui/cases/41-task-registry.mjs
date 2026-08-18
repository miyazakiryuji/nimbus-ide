/**
 * 板をウィンドウ横断で持つ（T-259 / T-260 / T-261 / T-262）の通し確認。
 *
 * ここでもテスト側が**別プロセスとして**記録を置く。板の状態がウィンドウの中にしか
 * 無かったのが元の問題なので、「他所が書いたものを拾えるか」が確認したいことそのもの。
 *
 * 置くのは「作業中のまま、担当セッションがもういない」タスク。
 * 板に出ること（T-259）・進捗が読めること（T-261）・点検で止まっていると分かること（T-262）を見る。
 */
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackText, labels, openNimbusTasksSidebar, runCommand, webviewText } from '../helpers.mjs';

const TASK_ID = '00000000-0000-4000-8000-000000000002';

export default {
	name: '別のウィンドウが足したタスクが板に出て、点検で止まっていると分かる',
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'tasks');
		mkdirSync(dir, { recursive: true });
		const stale = Date.now() - 2 * 60 * 60 * 1000;
		writeFileSync(
			join(dir, `${TASK_ID}.json`),
			JSON.stringify({
				taskId: TASK_ID,
				title: '別ウィンドウが置いたタスク',
				repoCwd: ctx.workspace,
				worktreePath: join(ctx.workspace, 'nowhere'),
				branch: 'nimbus/gui-test',
				prompt: '直して',
				state: 'running',
				sessionId: 'session-that-is-gone',
				ownerWindowId: 'gui-test-window',
				createdAt: stale,
				updatedAt: stale
			})
		);
		appendFileSync(
			join(dir, `${TASK_ID}.progress.jsonl`),
			`${JSON.stringify({ at: stale, kind: 'start', text: '開始（GUI テストが置いた）' })}\n` +
				`${JSON.stringify({ at: stale + 1000, kind: 'file', text: '/w/app/lib/main.dart' })}\n`
		);

		// 突き合わせは 5 秒ごと。書いてから拾われるまで待つ
		ctx.expect(await openNimbusTasksSidebar(page), 'Nimbus タスクのサイドバーを開けない');
		const board = await webviewText(page, ['別ウィンドウが置いたタスク'], { attempts: 12 });
		ctx.expect(board !== undefined, '別のウィンドウが置いたタスクが板に出てこない（横断で共有できていない）');
		ctx.expect(
			board.includes('開始（GUI テストが置いた）') || board.includes('/w/app/lib/main.dart'),
			`カードに直近の進捗が出ていない:\n${board.slice(0, 400)}`
		);

		// 点検（T-262）。担当セッションが居ないので「止まっている」として出るはず
		await runCommand(page, labels('command.checkTasks')[0]);
		await page.waitForTimeout(1500);
		const checked = await feedbackText(page);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		ctx.expect(
			checked.includes('別ウィンドウが置いたタスク'),
			`点検で止まっているタスクが出ない:\n${checked.slice(0, 400)}`
		);
		await ctx.shot('task-registry');
	}
};
