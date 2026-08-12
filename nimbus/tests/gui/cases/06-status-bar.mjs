/** ステータスバーに Nimbus の状態が出ているか */
export default {
	name: 'ステータスバーに Nimbus が出る',
	async run(page, ctx) {
		const status = await page.evaluate(() => document.querySelector('.part.statusbar')?.innerText ?? '');
		ctx.expect(status.includes('Nimbus'), `ステータスバーに Nimbus が無い: "${status}"`);
	}
};
