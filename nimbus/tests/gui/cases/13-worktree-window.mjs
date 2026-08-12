/**
 * worktree を別ウィンドウで開く導線（f3-f6.md §6 の 6 つめ）。
 *
 * 実際にタスクを作ると worktree を切って別ウィンドウが開いてしまい、後片付けが要る。
 * ここで確かめるのは**導線が生きていること** — タスクを作るコマンドが登録されていて、
 * 板に「新しいタスク」の入口があること。開いた先の窓は F4 の手動確認（§3）で見ている。
 */
export default {
	name: 'タスク作成と worktree の導線がある',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		await page.waitForTimeout(1000);
		await page.keyboard.type('Nimbus: 新しいタスク', { delay: 20 });
		await page.waitForTimeout(1200);
		const palette = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);

		ctx.expect(
			palette.includes('worktree'),
			`コマンドパレットに「新しいタスク（worktree を切って並列実行）」が無い:\n${palette.slice(0, 400)}`
		);
		await ctx.shot('worktree-entry');
	}
};
