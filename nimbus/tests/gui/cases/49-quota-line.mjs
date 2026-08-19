/**
 * 枠の残りが、走らせている最中に**読める形で**出ている（T-282）。
 *
 * 数字が届いているかはモジュールテスト（`usage.test.ts`）が見ている。
 * ここでしか分からないのは **1 行に収まっているか** —
 * `text-overflow: ellipsis` で切れていても、目には「そういう文言」に見えてしまう。
 * 実際に、既定のサイドバー幅で `週 残り 92…` と週の残りが末尾から消えていた。
 *
 * 枠の数字は実セッションのターンが終わってから届くので、`--with-claude` のときだけ走る。
 */

/** 入力欄の下の枠の行を、フレーム越しに読む */
async function readQuota(page) {
	for (const frame of page.frames()) {
		const found = await frame.$('#quota').catch(() => undefined);
		if (!found) {
			continue;
		}
		return frame.$eval('#quota', (el) => ({
			hidden: el.hidden,
			text: (el.textContent ?? '').trim(),
			tooltip: el.title,
			// **切れているかは測るしかない。** 見た目では気づけない
			truncated: el.scrollWidth > el.clientWidth + 1
		}));
	}
	return undefined;
}

export default {
	name: '枠の残りが入力欄の下に出て、末尾が切れていない（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}

		// ターンが終わると枠の数字が届く
		let quota = await readQuota(page);
		for (let i = 0; i < 30 && (!quota || quota.hidden); i++) {
			await page.waitForTimeout(1000);
			quota = await readQuota(page);
		}

		ctx.expect(quota !== undefined, 'コックピットの枠の行（#quota）が見つからない');
		ctx.expect(
			!quota.hidden && quota.text !== '',
			`枠の残りが出ない（枠のある契約で走らせているか確かめる）: ${JSON.stringify(quota)}`
		);
		ctx.expect(
			quota.text.includes('5 時間') && quota.text.includes('週'),
			`5 時間と週の両方が出ていない: ${JSON.stringify(quota)}`
		);
		// ここが眼目。週の残りが末尾から消えるのが実際に起きた
		ctx.expect(!quota.truncated, `枠の残りの行が末尾から切れている: ${JSON.stringify(quota)}`);
		ctx.expect(
			quota.tooltip.includes('リセット'),
			`いつ戻るかが、指を置いたときの中身に入っていない: ${JSON.stringify(quota)}`
		);

		await ctx.shot('quota-line');
	}
};
