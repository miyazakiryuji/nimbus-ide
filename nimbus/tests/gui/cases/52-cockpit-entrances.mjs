/**
 * コックピットの入口（T-289 / T-290 / T-292 / T-293 / T-294）。
 *
 * 「実装したはずなのに無い」という報告が続けて 4 件出た。どれもコマンドは在り、
 * **押す場所だけが無かった**。`package.json` の並びはモジュールテスト
 * （`cockpitMenus.test.ts`）が固定しているが、**実際に画面へ出て押せるか**はここでしか分からない。
 *
 * 押すのは「走っているセッションを見る」だけにする — `+`（新しいセッション）は
 * 実セッションを起こす＝課金が出るので、ここでは**出ていること**までにとどめる。
 */
import { notificationText, openNimbusSidebar, quickPickText } from '../helpers.mjs';

/** 面のタイトルに並んでいるボタンの名前 */
async function titleActions(page) {
	return page.evaluate(() =>
		[
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		]
			.map((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
			.join(' | ')
	);
}

/** 名前で 1 つ押す */
async function clickTitleAction(page, name) {
	return page.evaluate((needle) => {
		const found = [
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		].find((el) =>
			`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes(needle)
		);
		if (!found) {
			return false;
		}
		found.click();
		return true;
	}, name);
}

export default {
	name: 'コックピットのタイトルから、新規セッション・一覧・全画面が押せる',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		await page.waitForTimeout(1200);

		const actions = await titleActions(page);
		// 表に出す 3 つ。残り（右半分・タブで開く）は `...` に入るので、ここでは数えない
		for (const name of ['新しいセッション', '走っているセッション', '全画面']) {
			ctx.expect(
				actions.includes(name),
				`コックピットのタイトルに「${name}」が出ていない:\n${actions.slice(0, 400)}`
			);
		}

		// **出ているだけでは意味がない。** 実際に押して、答えが返るところまで見る
		ctx.expect(
			await clickTitleAction(page, '走っているセッション'),
			'「走っているセッションを見る」のボタンを押せない'
		);

		let answer = '';
		for (let i = 0; i < 14; i++) {
			await page.waitForTimeout(600);
			answer = `${await quickPickText(page)}\n${await notificationText(page)}`;
			if (answer.includes('セッション')) {
				break;
			}
		}
		ctx.expect(
			answer.includes('セッション'),
			`押しても何も返らない（台帳が空なら「載っているセッションはありません」が出るはず）:\n${answer.slice(0, 300)}`
		);

		await page.keyboard.press('Escape');
		await ctx.shot('cockpit-entrances');
	}
};
