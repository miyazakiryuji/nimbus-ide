/** スキル一覧に、ワークスペースのスキルが出るか（用意した gui-test-skill が見えること） */
export default {
	name: 'スキル一覧にプロジェクトのスキルが出る',
	async run(page, ctx) {
		const activity = await page.$('[aria-label*="Nimbus"], .activitybar [title*="Nimbus"]');
		if (activity) {
			await activity.click();
			await page.waitForTimeout(1000);
		}
		// 「スキル」セクションを開く（畳まれている場合がある）
		const header = await page.$('.pane-header[aria-label*="スキル"], .pane-header:has-text("スキル")');
		if (header) {
			const expanded = await header.getAttribute('aria-expanded');
			if (expanded === 'false') {
				await header.click();
				await page.waitForTimeout(800);
			}
		}
		await page.waitForTimeout(1500);
		const sidebar = await page.evaluate(() => document.querySelector('.part.sidebar')?.innerText ?? '');
		ctx.expect(
			sidebar.includes('gui-test-skill'),
			`用意したスキルが一覧に出ていない:\n${sidebar.slice(0, 400)}`
		);
	}
};
