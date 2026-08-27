/**
 * 「+」がセッションを**足す**操作であること（T-310）。
 *
 * 以前は「いまのを閉じて作り直す」実装で、押してもタブが増えず手応えが無かった。
 * まだ送っていないセッションは**下書き**として出るので、
 * **実セッション（課金）無しで**「押すと増える」を確かめられる。
 *
 * T-314 から、**狭いサイドバーではセッションの列を並べず ≡（Home）に畳む**
 * （利用者とすり合わせた形）。ここで見るのは
 * ① 2 回押すと ≡ の行が現れる ② ≡ を押すと Home に下書きが 2 行出る（前面は後のほう）
 * ③ 行を押すと前面が移り、Home が閉じて会話へ戻る。
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

/** Home の行を、フレーム越しに読む（`contentDocument` はパッケージ版では読めない） */
async function readHomeRows(page) {
	for (const frame of page.frames()) {
		const found = await frame.$$('.home-session').catch(() => []);
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

/** ≡（Home の開閉）を押す */
async function pressHomeToggle(page) {
	for (const frame of page.frames()) {
		const toggle = await frame.$('#homeToggle').catch(() => null);
		if (toggle) {
			await toggle.click();
			return true;
		}
	}
	return false;
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

		// タブ列は狭い面でも出す（T-338）。**DOM に在るかではなく、見えているか**を確かめる —
		// 以前は CSS で隠れていても textContent が読めたせいで、列が消えたまま緑が続いた
		let stripShown = false;
		for (let i = 0; i < 16 && !stripShown; i++) {
			await page.waitForTimeout(500);
			for (const frame of page.frames()) {
				stripShown = await frame
					.$eval('#sessionTabs', (el) => !el.hidden && el.offsetParent !== null && el.offsetHeight > 0)
					.catch(() => false);
				if (stripShown) {
					break;
				}
			}
		}
		ctx.expect(stripShown, '「+」を 2 回押したのに、タブ列が**見えて**いない');


		// ≡ を押すと Home に下書きが 2 行。前面は後から押したほう
		ctx.expect(await pressHomeToggle(page), '≡ を押せない');
		await page.waitForTimeout(600);
		let rows = await readHomeRows(page);
		ctx.expect(
			rows.length === 2 && rows.every((row) => row.text.includes('新しいセッション')),
			`Home に下書きが 2 行出ない: ${JSON.stringify(rows)}`
		);
		ctx.expect(
			!rows[0].active && rows[1].active,
			`前面が後から足したほうになっていない: ${JSON.stringify(rows)}`
		);

		// 1 行目を押すと前面が移り、Home は閉じて会話へ戻る
		for (const frame of page.frames()) {
			const first = (await frame.$$('.home-session').catch(() => []))[0];
			if (first) {
				await first.click();
				break;
			}
		}
		await page.waitForTimeout(800);
		let homeClosed = false;
		for (const frame of page.frames()) {
			homeClosed = await frame.$eval('#home', (el) => el.hidden).catch(() => false);
			if (homeClosed) {
				break;
			}
		}
		ctx.expect(homeClosed, 'Home の行を押しても会話へ戻らない');
		await pressHomeToggle(page);
		await page.waitForTimeout(600);
		rows = await readHomeRows(page);
		ctx.expect(
			rows.length === 2 && rows[0].active && !rows[1].active,
			`Home の行を押しても前面が移らない: ${JSON.stringify(rows)}`
		);

		await ctx.shot('new-session-draft');
		// **Home は閉じて終える。** ケースはアプリを共有しているので、開きっぱなしは
		// 次のケースの ≡ を「閉じる」動作に変えてしまう（フル実行でだけ落ちる罠になった）
		await pressHomeToggle(page);
		await page.waitForTimeout(600);

		// 列を**直接**押しても切り替わること（利用者の主要動線・T-338）。
		// いま前面は 1 枚目なので、2 枚目を押して本当に移るかを見る。
		// ※順序に意味がある: これを Home の検証の前に置くと、前面を動かして後段を壊す（実際に壊した）
		let flipped = false;
		for (const frame of page.frames()) {
			const rows = await frame.$$('.session-tab').catch(() => []);
			if (rows.length >= 2) {
				await rows[1].click();
				await page.waitForTimeout(1200);
				flipped = await frame
					.$$eval('.session-tab', (els) => els[1]?.classList.contains('active') ?? false)
					.catch(() => false);
				break;
			}
		}
		ctx.expect(flipped, 'タブ列の 2 枚目を押しても前面が移らない（列が飾りに戻っている）');
	}
};
