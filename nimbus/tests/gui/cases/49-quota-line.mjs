/**
 * 入力欄の下の帯（T-282 / T-291 / T-295）。
 *
 * 枠の残りが、走らせている最中に**読める形で**出ていること。
 * あわせて走らせかた（モデル・思考量）の札が出ていること。
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
			truncated: el.scrollWidth > el.clientWidth + 1,
			// バー・数字・絵文字が揃っているか（T-295）
			bars: el.querySelectorAll('.quota-bar').length,
			marks: [...el.querySelectorAll('.quota-mark')].map((mark) => mark.textContent).join('')
		}));
	}
	return undefined;
}

/** 走らせかたの札（T-291） */
async function readRun(page) {
	for (const frame of page.frames()) {
		const found = await frame.$('#pickModel').catch(() => undefined);
		if (!found) {
			continue;
		}
		return frame.evaluate(() => {
			const model = document.getElementById('pickModel');
			const effort = document.getElementById('pickEffort');
			const state = document.getElementById('sessionState');
			return {
				model: (model?.textContent ?? '').trim(),
				modelHidden: Boolean(model?.hidden),
				effort: (effort?.textContent ?? '').trim(),
				effortHidden: Boolean(effort?.hidden),
				state: (state?.textContent ?? '').trim(),
				stateHidden: Boolean(state?.hidden)
			};
		});
	}
	return undefined;
}

export default {
	name: '入力欄の下の帯に、走らせかたと枠の残りが出る（--with-claude）',
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
		// **数字だけにしない**（T-295）。バーと絵文字が同じことを言っていること
		ctx.expect(
			quota.bars >= 2 && /[🟢🟡🔴]/u.test(quota.marks),
			`枠の目盛り（バー・絵文字）が出ていない: ${JSON.stringify(quota)}`
		);

		// 走らせかたの札（T-291）。セッションがあるので出ているはず
		const run = await readRun(page);
		ctx.expect(run !== undefined, 'コックピットの帯（#pickModel）が見つからない');
		ctx.expect(
			!run.modelHidden && run.model !== '',
			`モデルの札が出ていない: ${JSON.stringify(run)}`
		);
		// **モデルの名前が出ていること。** 「Default (recommended)」とだけ出て、
		// どのモデルで走っているのか分からない状態になっていた（T-291）
		ctx.expect(
			!run.model.startsWith('Default'),
			`モデルの札が既定の行の名前のまま（どのモデルか分からない）: ${JSON.stringify(run)}`
		);
		// 状態が言葉で読めること（T-298）。記号だけだと読み取れないという声が出た
		ctx.expect(
			!run.stateHidden && /完了|作業中|あなたの番|許可待ち|中断|エラー/.test(run.state),
			`セッションの状態が言葉で出ていない: ${JSON.stringify(run)}`
		);

		await ctx.shot('quota-line');
	}
};
