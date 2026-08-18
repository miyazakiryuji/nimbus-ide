/**
 * 止まった場所をセッションへ渡す（T-254）の通し確認。
 *
 * 実際にデバッガを止めるには言語ランタイムと起動構成が要るので、ここでは
 * **押したら実行されて答えが返る**ところまでを見る（止まっていないときの答え）。
 * 「コマンドが一覧に出る」だけだと、押しても何も起きない飾りを通してしまう。
 */
import { feedbackText, labels, runCommand } from '../helpers.mjs';

export default {
	name: '止まった場所を渡すコマンドが、止まっていないときに理由を返す',
	async run(page, ctx) {
		await runCommand(page, labels('command.sendDebugStop')[0]);
		await page.waitForTimeout(1500);
		const answer = await feedbackText(page);
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		ctx.expect(
			answer.includes('止まっていません'),
			`押しても何も答えない（飾りになっている）:\n${answer.slice(0, 400)}`
		);
		await ctx.shot('debug-handoff');
	}
};
