/**
 * コックピットを VS Code のチャットの作りに寄せた（T-271）ことの確認。
 *
 * **存在確認で止めない。** 候補や定型は「出ている」だけでは意味がなく、
 * 押した結果が入力欄に入って初めて機能になる（T-244）。ここでは実際に押す。
 *
 * 応答の Markdown・コードブロックの描画は**実セッションが要る**ので、
 * ここでは扱わない ── 塊に分けるところは `chatMarkdown` のモジュールテスト（9 件）が見ている。
 */
import { openNimbusSidebar, webviewText } from '../helpers.mjs';

/** コックピットの webview フレームを掴む */
async function cockpitFrame(page, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#composer')) {
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
	name: 'コックピットが VS Code のチャットの作りになり、候補と定型が実際に入力欄へ入る',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		// 1. 空のときの案内が出ている
		const welcome = await webviewText(page, ['に頼む', 'Enter で送ります'], { attempts: 20 });
		ctx.expect(Boolean(welcome), '空のときの案内が出ていない（コックピットが描けていないかもしれない）');

		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの入力欄まわり（#composer）が見つからない');

		// 2. VS Code のチャットと同じで、入力欄とツールバーが 1 枚の箱に同居している
		const shape = await frame.evaluate(() => {
			const box = document.querySelector('.chat-input-container');
			return {
				hasBox: Boolean(box),
				hasInput: Boolean(box && box.querySelector('#input')),
				hasToolbar: Boolean(box && box.querySelector('.chat-input-toolbars')),
				hasSend: Boolean(box && box.querySelector('#send'))
			};
		});
		ctx.expect(
			shape.hasBox && shape.hasInput && shape.hasToolbar && shape.hasSend,
			`入力欄が 1 枚の箱になっていない: ${JSON.stringify(shape)}`
		);

		// 3. 案内の候補を**実際に押す**と、入力欄に入る
		const suggestion = await frame.$('.suggestion');
		ctx.expect(suggestion !== null, '空のときの候補が出ていない');
		const suggestionText = await suggestion.evaluate((el) => el.textContent ?? '');
		await suggestion.click();
		await page.waitForTimeout(400);
		const afterSuggestion = await frame.$eval('#input', (el) => el.value);
		ctx.expect(
			afterSuggestion === suggestionText && afterSuggestion.length > 0,
			`候補を押しても入力欄に入らない: 入力欄="${afterSuggestion}" 候補="${suggestionText}"`
		);

		// 4. `/` を打つと定型の候補が出て、**選ぶと**入力欄に入る
		await frame.$eval('#input', (el) => {
			el.value = '';
			el.dispatchEvent(new Event('input', { bubbles: true }));
		});
		const input = await frame.$('#input');
		await input.click();
		await input.type('/', { delay: 20 });
		await page.waitForTimeout(600);

		const slash = await frame.$('.slash-item');
		ctx.expect(slash !== null, '`/` を打っても定型の候補が出ない');
		await slash.click();
		await page.waitForTimeout(400);
		const afterSlash = await frame.$eval('#input', (el) => el.value);
		ctx.expect(
			afterSlash.length > 0 && !afterSlash.startsWith('/'),
			`定型を選んでも入力欄に入らない: "${afterSlash.slice(0, 80)}"`
		);

		// 枠の残りの行（T-282）
		const readQuota = () =>
			frame.$eval('#quota', (el) => ({
				hidden: el.hidden,
				text: (el.textContent ?? '').trim(),
				tooltip: el.title,
				// 入りきらずに末尾が切れていないか（`text-overflow: ellipsis` は見た目では気づけない）
				truncated: el.scrollWidth > el.clientWidth + 1
			}));

		if (ctx.withClaude) {
			// ターンが終わると枠の数字が届く
			let quota = await readQuota();
			for (let i = 0; i < 20 && quota.hidden; i++) {
				await page.waitForTimeout(1000);
				quota = await readQuota();
			}
			ctx.expect(
				!quota.hidden && quota.text !== '',
				`枠の残りが出ない（枠のある契約で走らせているか確かめる）: ${JSON.stringify(quota)}`
			);
			// **切れていたら意味がない。** 週の残りが末尾から消えるのが実際に起きた
			ctx.expect(!quota.truncated, `枠の残りの行が末尾から切れている: ${JSON.stringify(quota)}`);
			ctx.expect(
				quota.tooltip.includes('リセット'),
				`いつ戻るかが、指を置いたときの中身に入っていない: ${JSON.stringify(quota)}`
			);
		} else {
			// **セッションが無いときは空欄を置かず、行ごと消えている**こと
			const quota = await readQuota();
			ctx.expect(
				quota.hidden && quota.text === '',
				`枠の残りの行が、出すものが無いのに残っている: ${JSON.stringify(quota)}`
			);
		}

		await ctx.shot('cockpit-chat');
	}
};
