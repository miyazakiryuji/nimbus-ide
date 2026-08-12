/** Nimbus のビューが揃っているか（コックピット / タスク / スキル / 文脈） */
export default {
	name: 'Nimbus のビューが揃っている',
	async run(page, ctx) {
		// アクティビティバーの Nimbus を開く
		const activity = await page.$('[aria-label*="Nimbus"], .activitybar [title*="Nimbus"]');
		ctx.expect(activity !== null, 'アクティビティバーに Nimbus が無い');
		await activity.click();
		await page.waitForTimeout(1500);

		const sidebar = await page.evaluate(() => {
			const el = document.querySelector('.part.sidebar');
			return el ? el.innerText : '';
		});
		for (const name of ['コックピット', 'タスク', 'スキル', '文脈']) {
			ctx.expect(sidebar.includes(name), `サイドバーに「${name}」が無い:\n${sidebar.slice(0, 300)}`);
		}
		await ctx.shot('views');
	}
};
