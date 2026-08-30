/**
 * ≡（ハンバーガー）を廃止し、一覧を開いているときだけ「← 会話へ戻る」を出す
 * （T-345・利用者依頼 2026-08-30）。
 *
 * **入口を消すだけにしない。** ≡ は Home を開く唯一の入口だったので、
 * 廃止と同じコミットで `nimbus.openHome` を面のタイトルへ移した。
 * ここで見るのは「無くなったこと」だけでなく、**開けること・戻れること**まで。
 */
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

async function cockpit(page, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#sessionTabs')) {
					return frame;
				}
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

const shape = (frame) =>
	frame.evaluate(() => {
		const back = document.getElementById('homeBack');
		const home = document.querySelector('.home');
		return {
			hamburger: Boolean(document.querySelector('#homeToggle')),
			backShown: Boolean(back) && !back.hidden,
			homeOpen: Boolean(home) && !home.hidden
		};
	});

export default {
	name: '≡ が無くなり、一覧を開くと「← 会話へ戻る」が出て、押すと会話へ戻る',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const frame = await cockpit(page);
		ctx.expect(frame !== undefined, 'コックピットが見つからない');

		// 1. ≡ は無い。会話を見ているあいだは戻るボタンも出さない
		//    （押しても何も起きないボタンを置かない）
		const start = await shape(frame);
		ctx.expect(!start.hamburger, '≡（ハンバーガー）がまだ居る');
		ctx.expect(!start.backShown, `会話を見ているのに「← 会話へ戻る」が出ている: ${JSON.stringify(start)}`);

		// 2. **面のタイトルから一覧を開ける。** ≡ を消した代わりの入口が働くこと
		await runCommand(page, 'セッションの一覧（Home）を開く');
		await page.waitForTimeout(1500);
		const opened = await shape(await cockpit(page));
		ctx.expect(opened.homeOpen, `タイトルの入口から一覧が開かない: ${JSON.stringify(opened)}`);
		ctx.expect(opened.backShown, `一覧を開いたのに「← 会話へ戻る」が出ない: ${JSON.stringify(opened)}`);

		// 3. **押すと会話へ戻る。** 存在確認で止めない
		const view = await cockpit(page);
		await view.evaluate(() => {
			/** @type {HTMLElement} */ (document.getElementById('homeBack')).click();
		});
		await page.waitForTimeout(1200);
		const back = await shape(await cockpit(page));
		ctx.expect(!back.homeOpen, `「← 会話へ戻る」を押しても一覧が閉じない: ${JSON.stringify(back)}`);
		ctx.expect(!back.backShown, `会話へ戻ったのにボタンが残っている: ${JSON.stringify(back)}`);
		await ctx.shot('home-back');
	}
};
