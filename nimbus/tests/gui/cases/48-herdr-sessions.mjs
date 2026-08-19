/**
 * Herdr のセッションを一覧に混ぜる（T-279）の通し確認。
 *
 * Herdr 本体は入れない（同梱しない方針・権利の確認結果）。代わりに
 * **文書どおりの受け答えをする偽のソケット**を立て、Nimbus が読んで一覧に出すところまでを見る。
 * 読むだけで操作はしないので、選んでも開かないことも確かめる。
 */
import { createServer } from 'node:net';
import { feedbackText, labels, runCommand } from '../helpers.mjs';

export default {
	name: 'Herdr で動いているセッションが一覧に出る',
	async run(page, ctx) {
		const server = createServer((socket) => {
			socket.on('data', (chunk) => {
				const request = JSON.parse(chunk.toString('utf8').trim());
				socket.write(
					`${JSON.stringify({
						id: request.id,
						result: {
							agents: [
								{ pane_id: 'w1:p1', title: 'HERDR_GUI_PANE', cwd: ctx.workspace, agent_status: 'blocked' }
							]
						}
					})}\n`
				);
			});
		});
		await new Promise((done) => server.listen(ctx.herdrSocket, done));
		try {
			await runCommand(page, labels('command.showSessions')[0]);
			await page.waitForTimeout(1800);
			const listed = await feedbackText(page);
			await page.keyboard.press('Escape');
			await page.waitForTimeout(400);
			ctx.expect(
				listed.includes('HERDR_GUI_PANE'),
				`Herdr で動いているものが一覧に出ていない:\n${listed.slice(0, 400)}`
			);
			ctx.expect(
				listed.includes('Herdr'),
				`どちらの持ちものか分かる形になっていない:\n${listed.slice(0, 400)}`
			);
			await ctx.shot('herdr-sessions');
		} finally {
			server.close();
		}
	}
};
