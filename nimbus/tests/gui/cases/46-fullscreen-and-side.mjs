/**
 * コックピットの全画面（T-269）と、右半分に出すもの（T-270）の通し確認。
 *
 * 見るのは「コマンドが引ける」ではなく、**押した結果として画面が変わること**。
 * 全画面はサイドバーが畳まれること、右半分は押したら実際に答えが返ること。
 * セッションのタブは実セッションが 2 本要るので `--with-claude` の 47 で見る。
 */
import { feedbackText, labels, runCommand } from '../helpers.mjs';

async function sidebarVisible(page) {
	return page.evaluate(() => {
		const part = document.querySelector('.part.sidebar');
		if (!part) {
			return false;
		}
		const style = window.getComputedStyle(part);
		return style.display !== 'none' && style.visibility !== 'hidden' && part.clientWidth > 0;
	});
}

export default {
	name: '全画面にするとサイドバーが畳まれ、もう一度で戻る',
	async run(page, ctx) {
		await runCommand(page, labels('command.fullscreenCockpit')[0]);
		await page.waitForTimeout(2000);
		ctx.expect(!(await sidebarVisible(page)), '全画面にしてもサイドバーが畳まれていない');
		await ctx.shot('cockpit-fullscreen');

		await runCommand(page, labels('command.fullscreenCockpit')[0]);
		await page.waitForTimeout(2000);
		ctx.expect(await sidebarVisible(page), 'もう一度押してもサイドバーが戻らない');

		// 右半分（T-270）。セッションが無いときは、押した理由が返ること
		await runCommand(page, labels('command.showSessionSide')[0]);
		await page.waitForTimeout(1500);
		const answer = await feedbackText(page);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
		ctx.expect(
			answer.includes('セッションが始まっていません') || answer.includes('右半分に出すもの'),
			`押しても何も答えない（飾りになっている）:\n${answer.slice(0, 300)}`
		);
	}
};
