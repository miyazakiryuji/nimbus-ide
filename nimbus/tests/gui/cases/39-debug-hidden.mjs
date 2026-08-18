/**
 * 標準のデバッグをアクティビティバーから外した（T-246）。
 *
 * Claude 用のデバッグを用意するまでのあいだ、VS Code 標準のものは出さない。
 * ただし**消したのではなく隠しただけ**なので、両方を確かめる。
 *
 * - アイコンが出ていないこと
 * - それでも ⇧⌘D で開けること（登録は残っている＝ F5・ブレークポイントも生きている）
 *
 * 後者を見ないと、「隠した」と「壊した」の区別がつかない。
 * ビューの登録先ごと消すと F5 も `openPaneComposite` も巻き添えになるが、
 * 画面を見ただけではどちらも「アイコンが無い」に見える。
 */

/** 表示言語は起動のしかたで変わる（真っさらな設定の 1 回目は英語）。両方を候補にする */
const DEBUG_NAMES = ['実行とデバッグ', 'Run and Debug'];

async function activityBarText(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.activitybar [aria-label], .activitybar [title]')]
			.map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
			.join(' | ')
	);
}

async function sidebarTitle(page) {
	return page.evaluate(() => document.querySelector('.part.sidebar .title-label')?.innerText?.trim() ?? '');
}

export default {
	name: '標準のデバッグはアイコンを出さないが、開けば動く',
	async run(page, ctx) {
		const bar = await activityBarText(page);
		ctx.expect(
			!DEBUG_NAMES.some((name) => bar.includes(name)),
			`アクティビティバーに標準のデバッグが出ている:\n${bar.slice(0, 300)}`
		);

		// 空のエディタの案内にも出さない。ここは一番よく見る画面なので、
		// 残っていると「アイコンだけ消した」で終わってしまう
		const watermark = await page.evaluate(
			() => document.querySelector('.watermark-box')?.innerText ?? ''
		);
		// 案内が空だと、下の確認が素通りしてしまう
		ctx.expect(watermark.length > 0, '空のエディタの案内が読めない（セレクタが変わった可能性）');
		ctx.expect(
			!['Start Debugging', 'デバッグの開始'].some((name) => watermark.includes(name)),
			`空のエディタの案内に標準のデバッグが出ている:\n${watermark.slice(0, 200)}`
		);
		await ctx.shot('debug-hidden');

		// 隠しただけで、機能は残っていること
		await page.keyboard.press('Meta+Shift+KeyD');
		await page.waitForTimeout(2000);
		const title = await sidebarTitle(page);
		ctx.expect(
			DEBUG_NAMES.some((name) => title.toUpperCase().includes(name.toUpperCase())),
			`⇧⌘D でデバッグを開けない（隠したのではなく壊している）: 見出し「${title}」`
		);

		// 出しっぱなしにすると後のケースが別のサイドバーを見てしまう
		await page.keyboard.press('Escape');
		await page.waitForTimeout(500);
	}
};
