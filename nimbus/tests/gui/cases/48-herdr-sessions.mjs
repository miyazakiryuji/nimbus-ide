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
							// **本物の Herdr 0.8.2 が返す形**（T-299 で実物に繋いで写した）。
							// 以前は `title` / `cwd` だけの、自分で書いた形に答えていたので、
							// 本物との食い違い（題名が `w1:p1` になる）を捕まえられなかった
							type: 'agent_list',
							agents: [
								{
									terminal_id: 'term_6597312c885531',
									name: 'HERDR_GUI_PANE',
									agent: 'claude',
									agent_status: 'blocked',
									workspace_id: 'w1',
									tab_id: 'w1:t1',
									pane_id: 'w1:p1',
									focused: true,
									cwd: ctx.workspace,
									foreground_cwd: ctx.workspace,
									revision: 0
								}
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
