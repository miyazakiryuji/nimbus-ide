/** VS Code の名前や Copilot の導線が残っていないか（フォークとして最低限の線） */
export default {
	name: 'VS Code / Copilot の露出が無い',
	async run(page, ctx) {
		const text = await page.evaluate(() => document.body.innerText);
		ctx.expect(!/Sign in to use GitHub Copilot/i.test(text), 'Copilot のサインイン導線が出ている');
		ctx.expect(!/Welcome to VS Code/i.test(text), '「Welcome to VS Code」が出ている');
		// タイトルバー・ステータスバーに Nimbus の名が出ていること
		ctx.expect(/Nimbus/.test(text), '画面のどこにも Nimbus と出ていない');

		// 内蔵チャットの入口が戻っていないこと（T-238。一度塞いだのに、
		// 設定の既定だけでは profile に覚えられていて出てくることがある）
		const chatEntries = await page.evaluate(() =>
			[...document.querySelectorAll('.activitybar [aria-label], .composite-bar [aria-label]')]
				.map((el) => el.getAttribute('aria-label') ?? '')
				.filter((label) => /chat|チャット|Build with Agent/i.test(label))
		);
		ctx.expect(
			chatEntries.length === 0,
			`内蔵チャットの入口が戻っている（T-238）: ${chatEntries.join(' | ')}`
		);
	}
};
