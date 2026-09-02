/**
 * 敵対的試験（T-379 / adv-20）— 操作の直後に閉じても、下書きタブと打ちかけは残る（flush を待たない）。
 *
 * ## 何を疑っているか（観点: 中断とキャンセル — この観点は今回が最初のケース）
 *
 * 下書きの保存は `void context.workspaceState.update(...)`（`extension.ts` の `persistDrafts`）で、
 * **待たずに投げっぱなし**。拡張ホストから main への IPC なので、「+」を押した直後にウィンドウを
 * 閉じると、update が届く前に終了処理が走りうる。打ちかけの `vscode.setState` も webview →
 * ホストへの postMessage で、書き込みは終了時の flush 頼み。
 * ケース 69/71 は押してから **0.6〜0.9 秒待ってから**閉じている。人は待たない。
 *
 * ## 期待する振る舞い
 *
 * 押した直後・打った直後に閉じても、開き直したら同じタブ・同じ本文がある（T-368 / T-376 の約束は
 * 「閉じても消えない」であって「1 秒待ってから閉じれば消えない」ではない）。
 *
 * ## 手順の要点
 *
 * 「+」→ すぐ打鍵 → **待たずに** `ctx.restart()`。関門は閉じる直前の状態を読むこと自体だが、
 * 読む時間（数十 ms）以上は待たない。
 */
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

async function cockpit(page, selector, { attempts = 30 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$(selector)) {
					return frame;
				}
			} catch {
				// フレームが入れ替わっている最中
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

const tabNumbers = (frame) =>
	frame.evaluate(() =>
		[...document.querySelectorAll('.session-tab')].map((tab) =>
			(tab.querySelector('.session-tab-number')?.textContent ?? '').trim()
		)
	);

const TYPED = '閉じる直前に打った';

export default {
	name: '「+」と打鍵の直後に閉じても、下書きタブと打ちかけは残る',
	adversarial: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		// 列を出すには 2 本要る（1 本では列が畳まれる）。ここまでは普通に待つ
		await runCommand(page, '新しいセッション');
		await runCommand(page, '新しいセッション');
		let frame = await cockpit(page, '#sessionTabs');
		ctx.expect(frame !== undefined, 'コックピットのタブ列が見つからない');

		// ここから先は待たない。「+」→ 打鍵 → 閉じる
		await frame.click('.session-tab-add').catch(() => undefined);
		await frame.click('#input');
		await page.keyboard.type(TYPED, { delay: 0 });
		const before = await tabNumbers(frame);
		const typed = await frame.evaluate(() => document.getElementById('input').value);
		ctx.expect(before.length >= 3 && typed === TYPED, `閉じる直前の状態が作れていない: タブ ${JSON.stringify(before)} / 本文「${typed}」`);

		const reopened = await ctx.restart();
		ctx.expect(await openNimbusSidebar(reopened), '開き直したあと Nimbus のサイドバーを開けない');
		frame = await cockpit(reopened, '#sessionTabs');
		ctx.expect(frame !== undefined, '開き直したあとタブ列が見つからない');
		const after = await tabNumbers(frame);
		const restored = await frame.evaluate(() => document.getElementById('input')?.value ?? '');
		ctx.expect(
			JSON.stringify([...after].sort()) === JSON.stringify([...before].sort()),
			`押した直後に閉じたら下書きタブが失われた: 前 ${JSON.stringify(before)} → 後 ${JSON.stringify(after)}`
		);
		ctx.expect(restored === TYPED, `打った直後に閉じたら打ちかけが失われた: 「${restored}」`);
		await ctx.shot('adv-20-close-right-after');
	}
};
