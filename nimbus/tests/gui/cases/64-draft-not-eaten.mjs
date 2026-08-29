/**
 * 下書きのセッションが、別のセッションを押しただけで消えないこと（T-343・利用者報告 2026-08-29）。
 *
 * `updateSessionTabs()` の「下書きが本物になったら畳む」分岐は、
 * `activeSessionId && activeDraftId` の**同時成立から推測**して動く。
 * 前面を変える側が `activeDraftId` を外し忘れると、**押してもいない下書きが消える**。
 * 推測で動く場所は、**押した結果を数えて**守るしかない — タブの本数が減らないことを見る。
 *
 * 本物のセッションが 1 本要るので `--with-claude` のときだけ走る。
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

/** タブの並び（番号と名前、前面かどうか） */
async function tabs(frame) {
	return frame.evaluate(() =>
		[...document.querySelectorAll('.session-tab')].map((tab) => ({
			text: (tab.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 24),
			active: tab.classList.contains('active')
		}))
	);
}

export default {
	name: '下書きは、別のセッションを押しただけでは消えない（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		// 起動時のスモークが本物のセッションを 1 本起こしている。そこへ下書きを足す
		await runCommand(page, '新しいセッション');
		await page.waitForTimeout(1500);

		const frame = await cockpit(page);
		ctx.expect(frame !== undefined, 'コックピットのタブ列（#sessionTabs）が見つからない');

		const before = await tabs(frame);
		ctx.expect(before.length >= 2, `タブが 2 枚以上出ていない: ${JSON.stringify(before)}`);

		// 1. 下書き（＝いま前面にあるほう）を押しておく。押し直しても消えないこと
		const draftIndex = before.findIndex((tab) => tab.active);
		ctx.expect(draftIndex >= 0, `前面のタブが無い: ${JSON.stringify(before)}`);
		await frame.evaluate((index) => {
			/** @type {HTMLElement} */ (document.querySelectorAll('.session-tab')[index]).click();
		}, draftIndex);
		await page.waitForTimeout(1200);

		// 2. **本物のセッションを押す。** ここで下書きが消えていた
		const otherIndex = draftIndex === 0 ? 1 : 0;
		await frame.evaluate((index) => {
			/** @type {HTMLElement} */ (document.querySelectorAll('.session-tab')[index]).click();
		}, otherIndex);
		await page.waitForTimeout(1800);

		const after = await tabs(frame);
		ctx.expect(
			after.length >= before.length,
			`別のセッションを押しただけでタブが減った（下書きが消えた）: ${before.length} → ${after.length}\n` +
				`前: ${JSON.stringify(before)}\n後: ${JSON.stringify(after)}`
		);
		// 3. 押したほうが前面に来ている（消さない代わりに切り替わらない、では意味がない）
		ctx.expect(
			after[otherIndex]?.active === true,
			`押したタブが前面になっていない: ${JSON.stringify(after)}`
		);
		await ctx.shot('draft-not-eaten');
	}
};
