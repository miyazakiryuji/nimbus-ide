/**
 * セッションの台帳（T-247 / T-251 / T-252）の通し確認。
 *
 * 確かめるのは「コマンドが引ける」ではなく、**プロセスの外に置いた記録を読んで一覧に出すこと**。
 * ここでは拡張ではなくテスト側が記録を書く — 別のウィンドウが残した記録を
 * 読めるかどうかが台帳の存在理由なので、書き手が別プロセスであることに意味がある。
 *
 * 心拍を古くしてあるので「持ち主なし」として出る（＝続きから引き取れる）。
 * 実際に再開すると課金が発生するので、選ぶところまでは踏み込まない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, quickPickText, runCommand } from '../helpers.mjs';

export default {
	name: 'セッションの台帳が、別プロセスの記録を一覧に出す',
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'sessions');
		mkdirSync(dir, { recursive: true });
		const sessionId = '00000000-0000-4000-8000-000000000001';
		writeFileSync(
			join(dir, `${sessionId}.json`),
			JSON.stringify({
				sessionId,
				claudeSessionId: 'claude-gui-test',
				status: 'awaiting-input',
				cwd: ctx.workspace,
				title: 'GUI テストが置いた続き',
				createdAt: Date.now() - 600000,
				updatedAt: Date.now() - 600000,
				// 心拍は 10 分前 = 持ち主はもういない
				owner: { windowId: 'gui-test-window', pid: 1, heartbeatAt: Date.now() - 600000 }
			})
		);

		await runCommand(page, labels('command.showSessions')[0]);
		await page.waitForTimeout(1200);
		const listed = await quickPickText(page);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);

		ctx.expect(
			listed.includes('GUI テストが置いた続き'),
			`別プロセスが残した記録が一覧に出ていない:\n${listed.slice(0, 400)}`
		);
		ctx.expect(
			listed.includes('持ち主なし'),
			`心拍の切れた記録が「持ち主なし」になっていない:\n${listed.slice(0, 400)}`
		);
		await ctx.shot('session-registry');
	}
};
