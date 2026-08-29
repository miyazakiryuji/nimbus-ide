/**
 * セッションの列を**左の縦レール**にした（T-341・利用者依頼 2026-08-29）ことの確認。
 *
 * 横一列だと幅を全員で分け合うので、4 本開くと 1 枚 75px・名前に残るのは 30px＝2 文字。
 * 利用者の画面で「4 基…」「5 新…」まで潰れていた。**見た目ではなく寸法で測る** —
 * 「列が出ている」だけでは、名前が読めるかどうかは分からない。
 */
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

/** コックピットの webview フレーム */
async function cockpitFrame(page, { attempts = 20 } = {}) {
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

export default {
	name: 'セッションの列が左に縦へ積まれ、名前が切れずに読める',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		// 1. コックピットの既定幅（T-341 ②）。新しいプロファイルなので既定が効く。
		//    縦レール（132px 以上）と会話が同じ面を分け合うので、300px では会話が読めない
		const sidebar = await page.evaluate(() => {
			const el = document.querySelector('.part.sidebar');
			return el ? Math.round(el.getBoundingClientRect().width) : -1;
		});
		ctx.expect(sidebar >= 400, `コックピットの既定幅が狭い: ${sidebar}px（upstream の 300 のままかもしれない）`);

		// 2. 列は 2 本以上のときだけ出るので、下書きを足して 3 本にする
		for (let i = 0; i < 2; i++) {
			await runCommand(page, '新しいセッション');
			await page.waitForTimeout(1200);
		}
		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットのタブ列（#sessionTabs）が見つからない');

		const shape = await frame.evaluate(() => {
			const rail = document.querySelector('.session-tabs').getBoundingClientRect();
			// **分けている実体は `.cockpit-main`。** `.chat-list` は Home を開くと隠れて
			// 寸法が 0 になり、前のケースが Home を残していると誤って落ちる（実測）
			const log = document.querySelector('.cockpit-main').getBoundingClientRect();
			const tabs = [...document.querySelectorAll('.session-tab')].map((tab) => {
				const name = tab.querySelector('.session-tab-name');
				const box = tab.getBoundingClientRect();
				return {
					active: tab.classList.contains('active'),
					x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width),
					// **ここが利用者の困りごと。** 名前が器から溢れていれば「…」で切れている
					clipped: name ? name.scrollWidth > name.clientWidth + 1 : true
				};
			});
			return { railRight: Math.round(rail.right), logLeft: Math.round(log.x), tabs };
		});
		ctx.expect(shape.tabs.length >= 2, `タブが 2 枚以上出ていない: ${shape.tabs.length}`);

		// 3. 縦に積んである（横並びではない）
		const stacked = shape.tabs[1].y > shape.tabs[0].y && shape.tabs[1].x === shape.tabs[0].x;
		ctx.expect(stacked, `タブが縦に積まれていない（横一列に戻っている）: ${JSON.stringify(shape.tabs)}`);

		// 4. 列は会話の**左**にある
		ctx.expect(
			shape.railRight <= shape.logLeft,
			`列が会話の左にない: 列の右端 ${shape.railRight} / 会話の左端 ${shape.logLeft}`
		);

		// 5. **名前が切れていない。** 前面のタブは × と状態が同居して幅を食うので、
		//    背面のタブで見る（横一列のときはここが必ず切れていた）
		const background = shape.tabs.find((tab) => !tab.active);
		ctx.expect(background !== undefined, '背面のタブが無い');
		ctx.expect(
			!background.clipped,
			`背面のタブの名前が切れている（幅 ${background.width}px）— 名前が飾りに戻っている`
		);

		// 6. 縦にしても**押せば切り替わる**（作りを変えた引き換えに機能を落としていない）
		const before = await frame.evaluate(() =>
			[...document.querySelectorAll('.session-tab')].findIndex((t) => t.classList.contains('active'))
		);
		const target = before === 0 ? 1 : 0;
		await frame.evaluate((index) => {
			/** @type {HTMLElement} */ (document.querySelectorAll('.session-tab')[index]).click();
		}, target);
		await page.waitForTimeout(1500);
		const after = await frame.evaluate(() =>
			[...document.querySelectorAll('.session-tab')].findIndex((t) => t.classList.contains('active'))
		);
		ctx.expect(after === target, `列の ${target + 1} 枚目を押しても前面が移らない: ${before} → ${after}`);
		await ctx.shot('session-rail');
	}
};
