/**
 * **閉じて開き直しても、開いていたセッションが消えない**
 * （T-368・利用者報告 2026-09-01「一度閉じてから開いた時に、開いていた複数セッションが
 * 全て消えていました。このような確認漏れが多すぎます」）。
 *
 * ## なぜこのケースが要るのか（T-369）
 *
 * ここまでの GUI テストは **1 つの Electron を起動しっぱなしで全件を回していた**。
 * つまり「アプリを閉じて開き直す」経路が、66 件のどれも通っていなかった。
 * 再起動をまたいで初めて壊れるもの — 台帳・タブの復元・下書き・覚えた幅 — は
 * **まるごと検査の外**にあり、T-368 はそこをまっすぐ通り抜けた。
 *
 * 直したのは 2 つ:
 *   ① 下書き（`drafts`）が `workspaceState` に一切書かれておらず、閉じた瞬間に消えていた
 *   ② `activate()` の直下にタブを描き直す呼び出しが無く、戻すものがあっても出なかった
 *      （`ready` の `snapshot()` 経由でしか描かれない）
 *
 * **「+ を押した数だけタブが残る」ところまで見る。** 存在確認で止めると、
 * 空の器を本物として通してしまう（利用者指示「押して実行されるまで確かめる」）。
 *
 * 課金の要る本物のセッションは使わない — 下書きだけで、この経路の壊れかたは出せる。
 */
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

async function cockpit(page, { attempts = 30 } = {}) {
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

/** タブの並び（番号と見出し）。**再起動をまたいで比べる**ので、揺れる値は入れない */
async function tabs(frame) {
	return frame.evaluate(() =>
		[...document.querySelectorAll('.session-tab')].map((tab) =>
			(tab.querySelector('.session-tab-number')?.textContent ?? '').trim()
		)
	);
}

export default {
	name: '閉じて開き直しても、開いていたセッションが消えない（T-368 / T-369）',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		// 1. 下書きを 3 本立てる。**押して増えるところまで**見る（数えないと器を通す）
		for (let i = 0; i < 3; i++) {
			await runCommand(page, '新しいセッション');
			await page.waitForTimeout(900);
		}
		let frame = await cockpit(page);
		ctx.expect(frame !== undefined, 'コックピットのタブ列（#sessionTabs）が見つからない');

		const before = await tabs(frame);
		ctx.expect(
			before.length >= 3,
			`「+」を 3 回押してもタブが 3 枚に届かない（押した手応えが無い）: ${JSON.stringify(before)}`
		);

		// 2. **アプリを閉じて、同じプロファイルで開き直す** — ここが未検査だった経路
		const reopened = await ctx.restart();

		// 3. 開き直したあと、タブが戻っている
		ctx.expect(await openNimbusSidebar(reopened), '開き直したあと Nimbus のサイドバーを開けない');
		frame = await cockpit(reopened);
		ctx.expect(frame !== undefined, '開き直したあとコックピットのタブ列が見つからない');

		const after = await tabs(frame);
		ctx.expect(
			after.length >= before.length,
			`閉じて開いたらタブが減った（利用者が見た「全部消えた」そのもの）: ` +
				`${before.length} 枚 → ${after.length} 枚 / 前 ${JSON.stringify(before)} 後 ${JSON.stringify(after)}`
		);
		/*
		 * 番号（T-316）は名札であって席順ではない。**同じ番号が同じだけ戻る**ことまで見る —
		 * 枚数だけだと「別のものが 3 枚出た」を通してしまう
		 */
		for (const number of before) {
			ctx.expect(
				after.includes(number),
				`開き直したらセッション ${number} が消えた: 前 ${JSON.stringify(before)} 後 ${JSON.stringify(after)}`
			);
		}

		await ctx.shot('restart-keeps-sessions');
	}
};
