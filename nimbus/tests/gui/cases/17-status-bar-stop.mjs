/**
 * ステータスバーの Nimbus 表示（T-020 文脈バー / T-057 停止ボタン）。
 *
 * 停止ボタンは**動いているときだけ**出るのが仕様なので、
 * セッションを開始していない状態では「出ていないこと」を確かめる。
 * 出しっぱなしになる回帰は、これでしか捕まえられない。
 */
export default {
	name: '停止ボタンは動いていないときに出ていない',
	async run(page, ctx) {
		const status = await page.evaluate(() => document.querySelector('.part.statusbar')?.innerText ?? '');
		ctx.expect(status.includes('Nimbus'), `ステータスバーに Nimbus が無い:\n${status.slice(0, 300)}`);
		ctx.expect(!status.includes('停止'), `セッション未開始なのに停止ボタンが出ている:\n${status.slice(0, 300)}`);
		await ctx.shot('status-bar-idle');
	}
};
