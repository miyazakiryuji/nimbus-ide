/**
 * セッションの各段階を、実際に走らせて撮る（T-288 / T-298）。
 *
 * **止まった絵では UI を読めない。** 思考中・ツール実行中・完了で、
 * 何が出ていて何が出ていないかは動かさないと分からない。
 * ここでは「走っている最中に、状態と止める手が出ているか」を見て、
 * あわせて各段階を撮る（意匠の見直しの材料にする）。
 *
 * 実セッションが要るので `--with-claude` のときだけ走る。
 */

/** コックピットの帯と入力欄まわりを読む */
async function readCockpit(page) {
	for (const frame of page.frames()) {
		const found = await frame.$('#sessionState').catch(() => undefined);
		if (!found) {
			continue;
		}
		return frame.evaluate(() => {
			const state = document.getElementById('sessionState');
			const stop = document.getElementById('interrupt');
			const send = document.getElementById('send');
			const status = document.getElementById('statusText');
			return {
				state: (state?.textContent ?? '').trim(),
				stateHidden: Boolean(state?.hidden),
				stopHidden: Boolean(stop?.hidden),
				sendHidden: Boolean(send?.hidden),
				status: (status?.textContent ?? '').trim()
			};
		});
	}
	return undefined;
}

/** 入力欄へ打って送る */
async function send(page, text) {
	for (const frame of page.frames()) {
		const input = await frame.$('#input');
		if (!input) {
			continue;
		}
		await input.click();
		await input.type(text, { delay: 8 });
		await page.keyboard.press('Enter');
		return true;
	}
	return false;
}

export default {
	name: 'セッションの段階（作業中 → 完了）が、状態と手の出かたで読み取れる（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}

		// 起動時のスモークのターンが終わるまで待つ
		let before = await readCockpit(page);
		for (let i = 0; i < 30 && (!before || before.stateHidden); i++) {
			await page.waitForTimeout(1000);
			before = await readCockpit(page);
		}
		ctx.expect(before !== undefined, 'コックピットの帯が見つからない');
		await ctx.shot('stage-1-done');

		// ツールを使う指示を出す（思考 → ツール → 応答、の段階が出る）
		ctx.expect(await send(page, 'このフォルダのファイルを 1 回だけ一覧して、数だけ答えて'), '入力欄が見つからない');

		// **走っている最中**を捕まえる。状態が「作業中」になり、止める手が出ているはず
		let running;
		for (let i = 0; i < 25; i++) {
			await page.waitForTimeout(400);
			const now = await readCockpit(page);
			if (now && !now.stopHidden) {
				running = now;
				break;
			}
		}
		ctx.expect(running !== undefined, `走っている最中に止めるボタンが出ない: ${JSON.stringify(before)}`);
		ctx.expect(
			running.state.includes('作業中') || running.state.includes('許可待ち'),
			`走っている最中なのに状態がそう出ていない: ${JSON.stringify(running)}`
		);
		await ctx.shot('stage-2-working');

		// 終わると、止める手が引っ込んで状態が戻る
		let after;
		for (let i = 0; i < 60; i++) {
			await page.waitForTimeout(1000);
			after = await readCockpit(page);
			if (after && after.stopHidden && !after.state.includes('作業中')) {
				break;
			}
		}
		ctx.expect(
			after && after.stopHidden,
			`終わったのに止めるボタンが残っている: ${JSON.stringify(after)}`
		);
		ctx.expect(
			after.state.includes('あなたの番') || after.state.includes('完了'),
			`終わったのに状態が戻っていない: ${JSON.stringify(after)}`
		);
		await ctx.shot('stage-3-after');
	}
};
