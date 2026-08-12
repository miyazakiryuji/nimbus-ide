/**
 * 実際に Claude と 1 往復する。課金が発生するので --with-claude を付けたときだけ走る。
 * NIMBUS_SMOKE_PROMPT を渡してあるので、起動時に自動で 1 通送られている。
 */
export default {
	name: '実セッションが往復する（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		const deadline = Date.now() + 120000;
		let text = '';
		while (Date.now() < deadline) {
			text = await page.evaluate(() => document.querySelector('.part.sidebar')?.innerText ?? '');
			if (text.includes('NIMBUS_GUI_OK')) {
				break;
			}
			await page.waitForTimeout(2000);
		}
		ctx.expect(text.includes('NIMBUS_GUI_OK'), `Claude の応答がコックピットに出ない:\n${text.slice(0, 400)}`);
		await ctx.shot('claude-session');
	}
};
