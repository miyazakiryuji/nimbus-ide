/**
 * 権限モードが送信の視野に出る（T-327・人間工学 E3）。
 *
 * 点検（2026-08-18）の最重量所見の残り — 取り返しのつかない操作の入口（送信）に、
 * いまどの権限で走るかが出ていなかった。モデルのチップと違い、
 * **セッションが無くても出る**（送る前にこそ見たい値）。
 *
 * 見るのは ① セッション未開始でもチップが出て値を持つ ② 押すと切り替えの
 * QuickPick が開く（「いまは」が出る）③ Escape で閉じても壊れない。
 */

/** コックピットのフレームを掴む */
async function cockpitFrame(page, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#pickPolicy')) {
					return frame;
				}
			} catch {
				// 入れ替わり中のフレームは飛ばす
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

export default {
	name: '権限モードのチップが送信の隣に出て、押すと切り替えが開く',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);

		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットに #pickPolicy が見つからない');

		// 1. セッション未開始でも、値を持って出ている
		let chip = { hidden: true, text: '' };
		for (let i = 0; i < 12 && (chip.hidden || !chip.text); i++) {
			await page.waitForTimeout(500);
			chip = await frame
				.$eval('#pickPolicy', (el) => ({ hidden: el.hidden, text: (el.textContent ?? '').trim() }))
				.catch(() => ({ hidden: true, text: '' }));
		}
		ctx.expect(!chip.hidden, '権限チップが出ていない（セッション未開始では消えているのかもしれない）');
		ctx.expect(
			chip.text.startsWith('権限 ') && chip.text.length > '権限 '.length,
			`権限チップに値が無い: "${chip.text}"`
		);

		// 2. 押すと切り替えの QuickPick が開く
		await frame.$eval('#pickPolicy', (el) => el.click());
		let picker = '';
		for (let i = 0; i < 12 && !picker.includes('いまは'); i++) {
			await page.waitForTimeout(500);
			picker = await page.evaluate(() => {
				const widget = document.querySelector('.quick-input-widget');
				return widget && widget.offsetParent !== null ? (widget.textContent ?? '') : '';
			});
		}
		ctx.expect(
			picker.includes('いまは'),
			`チップを押しても切り替えの QuickPick が開かない:\n${picker.slice(0, 300)}`
		);

		// 3. 閉じても壊れない（チップは出たまま）
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);
		const still = await frame.$eval('#pickPolicy', (el) => !el.hidden).catch(() => false);
		ctx.expect(still, 'QuickPick を閉じたら権限チップが消えた');

		await ctx.shot('policy-chip');
	}
};
