/**
 * ケースの間のリセットが**本当に効く**（T-359 / T-340）。
 *
 * GUI テストは 1 つの Electron を全ケースで共有する。以前は `resetWorkbench` が
 * **エディタしか閉じていなかった**ので、拡張と面の状態が次のケースへ持ち越され、
 * **同じバイナリでも走らせるたびに 8 件前後落ちていた**（A/B 実測: 直し前 55/63・直し後 54/63、
 * 失敗 7 件が共通。同じバイナリが数時間前は 63/63）。
 *
 * **「リセットしたつもりで効いていない」がいちばん困る**ので、
 * ここでは**わざと汚してからリセットし、空になったことを画面で確かめる**。
 * 拡張の自己申告（`report`）だけを信じない — 申告が 0 でも DOM に残っていたら落とす
 * （Codex の指摘 2026-08-31「自己申告と実画面の二重確認」）。
 *
 * このケースが緑でないかぎり、**他の 60 件以上の結果は解釈できない**。
 */
import { openNimbusSidebar, runCommand, labels } from '../helpers.mjs';

/** コックピットの面（テスト用の口を持っているもの）を掴む */
async function cockpitFrame(page, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			const has = await frame.evaluate(() => Boolean(window.__nimbusTest)).catch(() => false);
			if (has) {
				return frame;
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/** 面に何が残っているか。**リセットの申告ではなく、実際の DOM を数える** */
function look(frame) {
	return frame.evaluate(() => ({
		attachments: document.querySelectorAll('.attachment').length,
		sessionTabs: document.querySelectorAll('.session-tab').length,
		turns: document.querySelectorAll('.turn').length,
		approvals: document.querySelectorAll('#approvals > *').length,
		input: (document.getElementById('input')?.value ?? '').length,
		homeOpen: !document.getElementById('home')?.hidden
	}));
}

const describe = (state) =>
	`添付 ${state.attachments} / 列 ${state.sessionTabs} / 発言 ${state.turns} / ` +
	`承認 ${state.approvals} / 入力 ${state.input} 字 / 一覧 ${state.homeOpen ? '開' : '閉'}`;

export default {
	name: 'ケースの間のリセットで、面も拡張もまっさらに戻る（T-359）',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの面にテスト用の口（window.__nimbusTest）が無い');

		// ── わざと汚す ──────────────────────────────────────────────
		// 下書きを 3 本（列と番号が溜まる）
		for (let i = 0; i < 3; i++) {
			await runCommand(page, labels('command.newSession')[0]);
			await page.waitForTimeout(500);
		}
		// 入力欄に書きかけを残し、添付を 1 枚積み、一覧を開く
		await frame.evaluate(() => {
			const input = document.getElementById('input');
			input.value = 'これは前のケースの書きかけです';
			input.dispatchEvent(new Event('input', { bubbles: true }));
		});
		await runCommand(page, 'セッションの一覧（Home）を開く');
		await page.waitForTimeout(900);

		const dirty = await look(frame);
		/*
		 * **汚せていなければ、このケースは何も確かめていない**（偽の緑）。
		 * リセットが効いたのか、そもそも汚れていなかったのかを区別できなくなる
		 */
		ctx.expect(
			dirty.input > 0 && (dirty.sessionTabs > 0 || dirty.homeOpen),
			`汚せていないので、リセットの効きを確かめられない: ${describe(dirty)}`
		);

		// ── リセットする ────────────────────────────────────────────
		const report = await frame.evaluate(() => window.__nimbusTest.reset());
		ctx.expect(report && !report.timedOut, `リセットの返事が来ない: ${JSON.stringify(report)}`);
		ctx.expect(
			!report.unavailable,
			'拡張がリセットに応じていない（NIMBUS_SMOKE が渡っていないか、口が繋がっていない）'
		);

		// ── 拡張の自己申告 ──────────────────────────────────────────
		ctx.expect(
			report.acked === report.surfaces,
			`面の返事が揃わない（${report.acked}/${report.surfaces}）— 待たずに次のケースへ進むと汚れる`
		);
		ctx.expect(
			(report.errors ?? []).length === 0,
			`リセットでエラー: ${(report.errors ?? []).join(' / ')}`
		);
		ctx.expect(
			report.sessions === 0 && report.drafts === 0 && report.pending === 0,
			`拡張に残っている: セッション ${report.sessions} / 下書き ${report.drafts} / 承認待ち ${report.pending}`
		);

		// ── 実画面でも確かめる（申告を信じない）───────────────────────
		await page.waitForTimeout(700);
		const clean = await look(frame);
		ctx.expect(
			clean.attachments === 0 && clean.turns === 0 && clean.approvals === 0 &&
				clean.input === 0 && !clean.homeOpen,
			`申告は空なのに画面に残っている（自己申告だけを信じない）: ${describe(clean)}`
		);

		// ── 遅れて戻ってこないか（1.5 秒待って見直す）─────────────────
		await page.waitForTimeout(1500);
		const later = await look(frame);
		ctx.expect(
			later.attachments === 0 && later.turns === 0 && later.input === 0 && !later.homeOpen,
			`リセットのあと、遅れて戻ってきた: ${describe(later)}`
		);

		// ── 2 回続けても同じ（冪等）──────────────────────────────────
		const again = await frame.evaluate(() => window.__nimbusTest.reset());
		ctx.expect(
			again && !again.timedOut && again.acked === again.surfaces && again.sessions === 0,
			`2 回目のリセットで結果が変わった: ${JSON.stringify(again)}`
		);

		await ctx.shot('reset-between-cases');
	}
};
