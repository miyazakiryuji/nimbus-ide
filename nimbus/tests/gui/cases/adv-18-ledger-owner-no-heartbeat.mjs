/**
 * 敵対的試験（T-379 / adv-18）— 持ち主の心拍が欠けた記録は、前回のセッションとして戻らず、有効化も落ちない。
 *
 * ## 何を疑っているか
 *
 * 台帳の関門 `isSessionRecord()`（`core/sessionRegistry.ts`）は `owner` が**オブジェクトであること**
 * しか見ず、`owner.heartbeatAt` の型を見ない（T-347 で型を見るようにしたのは平らな項目だけ）。
 * `owner: { windowId, pid }` の記録が素通りすると:
 * - `isOwnerAlive()` は `now - undefined < ttl` ＝ `NaN < ttl` ＝ false → 「持ち主なし」
 * - `forgettable()` は T-374 で `Math.max(updatedAt, owner.heartbeatAt)` になった →
 *   `Math.max(x, undefined)` ＝ NaN → `now - NaN > 7日` ＝ false → **永遠に掃除されない**
 * - `resumeCandidates()` は「持ち主なし・終わっていない・鍵がある・このフォルダ」を満たすので
 *   **開き直すたびに「前回のセッション」としてタブに戻り続ける**（× で消さない限り）
 *
 * T-374 の式は私（この試験の書き手）が入れたもの。自分の直しを自分で撃つ。
 *
 * ## 期待する振る舞い
 *
 * 持ち主の形が崩れた記録は「読めない記録」として数に入れない（adv-01 と同じ原則）。
 * 前回のセッションとして戻らず、有効化も落ちない。無事な記録は戻り、置き去りは掃除される。
 *
 * ## 手順の要点
 *
 * 記録を 3 本置いて開き直す — ①無事な前回（心拍 10 分前・鍵あり）→ **戻るはず**（これが戻らないなら
 * この試験の cwd の当てかたが間違っている ＝ 偽の緑の関門）②30 日前で心拍も止まった置き去り →
 * **掃除されるはず**（`sweep()` が走った証拠）③心拍の欠けた毒（30 日前・鍵あり）→ **戻らないはず**。
 */
import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { notificationText, openNimbusSidebar } from '../helpers.mjs';

async function cockpit(page, { attempts = 24 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#sessionTabs')) {
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

/**
 * タブの見出し。**`textContent` は畳まれる**（実測: `■1無事な前回 adv…`）ので、
 * 全文が入っている `title` 属性（`${番号}. ${全文} — ${状態}`）で探す
 */
const tabTexts = (frame) =>
	frame.evaluate(() =>
		[...document.querySelectorAll('.session-tab')].map((tab) => (tab.getAttribute('title') ?? tab.textContent ?? '').replace(/\s+/g, ' ').trim())
	);

export default {
	name: '持ち主の心拍が欠けた記録は、前回のセッションとして戻らず、有効化も落ちない',
	adversarial: true,
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'sessions');
		mkdirSync(dir, { recursive: true });
		const now = Date.now();
		const DAY = 86_400_000;
		const files = {
			good: join(dir, 'adv-18-good.json'),
			stale: join(dir, 'adv-18-stale.json'),
			poison: join(dir, 'adv-18-no-heartbeat.json')
		};
		const record = (sessionId, title, ages, owner) =>
			JSON.stringify({
				sessionId,
				status: 'awaiting-input',
				cwd: ctx.workspace,
				claudeSessionId: `${sessionId}-claude`,
				title,
				createdAt: now - ages,
				updatedAt: now - ages,
				owner
			});
		const live = await ctx.restart({
			beforeLaunch: async () => {
				// ① 無事な前回（心拍 10 分前 ＝ 持ち主なし・7 日以内）→ 戻るはず
				writeFileSync(files.good, record('adv-18-good', '無事な前回 adv-18', 600_000, { windowId: 'adv-18-g', pid: 1, heartbeatAt: now - 600_000 }));
				// ② 置き去り（30 日前・心拍も 30 日前）→ 掃除されるはず
				writeFileSync(files.stale, record('adv-18-stale', '置き去り adv-18', 30 * DAY, { windowId: 'adv-18-s', pid: 1, heartbeatAt: now - 30 * DAY }));
				// ③ 毒: 心拍が欠けた持ち主（30 日前）→ 戻らないはず・掃除の式を NaN にする
				writeFileSync(files.poison, record('adv-18-poison', '心拍の無い記録 adv-18', 30 * DAY, { windowId: 'adv-18-p', pid: 1 }));
			}
		});
		const notice = await notificationText(live);
		const opened = await openNimbusSidebar(live);
		const frame = opened ? await cockpit(live) : undefined;
		try {
			ctx.expect(opened && frame !== undefined, `開き直したあとコックピットが出ない。通知:\n${notice.slice(0, 600)}`);
			// 復元は起動直後と 30 秒後の 2 回ある。1 回目で戻るはずだが、描画を待つ
			let texts = [];
			for (let i = 0; i < 16; i++) {
				texts = await tabTexts(frame);
				if (texts.some((t) => t.includes('無事な前回 adv-18'))) {
					break;
				}
				await live.waitForTimeout(500);
			}
			// 関門: 無事な記録が戻っている（戻らないなら cwd の当てかたが違い、この先は何も確かめていない）
			ctx.expect(
				texts.some((t) => t.includes('無事な前回 adv-18')),
				`無事な前回のセッションがタブに戻らない（この試験の前提が崩れている）: ${JSON.stringify(texts)}\n通知:\n${notice.slice(0, 400)}`
			);
			// 掃除が走った証拠: 置き去りは消えている
			ctx.expect(!existsSync(files.stale), '30 日前の置き去り記録が掃除されていない（sweep が走っていない）');
			// 本命: 心拍の欠けた記録は戻らない
			ctx.expect(
				!texts.some((t) => t.includes('心拍の無い記録 adv-18')),
				`持ち主の心拍が欠けた記録が「前回のセッション」として戻った（掃除の式が NaN で永遠に残る）: ${JSON.stringify(texts)}`
			);
			await ctx.shot('adv-18-ledger-owner-no-heartbeat');
		} finally {
			for (const file of Object.values(files)) {
				try {
					rmSync(file, { force: true });
				} catch (error) {
					console.log(`  ！ adv-18: 台帳の後始末に失敗しました: ${file}（${error.message}）`);
				}
			}
			await live.waitForTimeout(1200);
		}
	}
};
