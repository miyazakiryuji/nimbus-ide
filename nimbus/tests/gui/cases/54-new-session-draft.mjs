/**
 * 「+」がセッションを**足す**操作であること（T-303 = 板の旧番号。採番し直し後は T-310）。
 *
 * 以前は「いまのを閉じて作り直す」実装で、押してもタブが増えず手応えが無かった。
 * まだ送っていないセッションは**下書き**としてタブに出るので、
 * **実セッション（課金）無しで**「押すと増える」を確かめられる。
 *
 * ここで見るのは ① 2 回押すと下書きのタブが 2 枚出る ② 前面は後から押したほう
 * ③ タブを押すと下書きの間で切り替わる（押しても壊れない）。
 */

/** 面のタイトルの「新しいセッション」を押す */
async function pressNewSession(page) {
	return page.evaluate(() => {
		const found = [
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		].find((el) =>
			`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes('新しいセッション')
		);
		if (!found) {
			return false;
		}
		found.click();
		return true;
	});
}

/** タブの列を、フレーム越しに読む（`contentDocument` はパッケージ版では読めない） */
async function readTabs(page) {
	for (const frame of page.frames()) {
		const found = await frame.$$('.session-tab').catch(() => []);
		if (found.length > 0) {
			return Promise.all(
				found.map((el) =>
					el.evaluate((node) => ({
						text: (node.textContent ?? '').trim(),
						active: node.classList.contains('active')
					}))
				)
			);
		}
	}
	return [];
}

export default {
	name: '「+」を押すたびにセッション（下書き）が増える',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);

		// 2 回押す。1 枚だけだと列は出ない（切り替える先が無い）ので、2 枚で列が現れる
		ctx.expect(await pressNewSession(page), 'コックピットのタイトルに「新しいセッション」が無い');
		await page.waitForTimeout(800);
		ctx.expect(await pressNewSession(page), '2 回目の「新しいセッション」を押せない');

		let tabs = [];
		for (let i = 0; i < 16 && tabs.length < 2; i++) {
			await page.waitForTimeout(500);
			tabs = await readTabs(page);
		}
		ctx.expect(
			tabs.length === 2 && tabs.every((tab) => tab.text.includes('新しいセッション')),
			`「+」を 2 回押したのに下書きのタブが 2 枚出ない: ${JSON.stringify(tabs)}`
		);
		// 前面は後から押したほう
		ctx.expect(
			!tabs[0].active && tabs[1].active,
			`前面のタブが後から足したほうになっていない: ${JSON.stringify(tabs)}`
		);

		// 1 枚目を押すと前面が移る（下書きの間の切り替えでも壊れない）
		for (const frame of page.frames()) {
			const first = (await frame.$$('.session-tab').catch(() => []))[0];
			if (first) {
				await first.click();
				break;
			}
		}
		await page.waitForTimeout(800);
		tabs = await readTabs(page);
		ctx.expect(
			tabs.length === 2 && tabs[0].active && !tabs[1].active,
			`下書きのタブを押しても前面が移らない: ${JSON.stringify(tabs)}`
		);

		await ctx.shot('new-session-draft');
	}
};
