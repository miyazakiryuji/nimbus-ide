/**
 * 敵対的試験 adv-12（T-345）: **タブの面でも**一覧を開いて会話へ戻れる。
 *
 * **書き直しの経緯（2026-08-31 00:30）** — 設計時（`nimbus/docs/testing/adversarial.md` の
 * adv-12 節）は ≡（`#homeToggle`）を押す前提だったが、`d02cd68fc1f` で ≡ は廃止され、
 * 開く役は面のタイトルの `nimbus.openHome` へ、戻る役は `#homeBack` へ割れた。
 * セレクタごと作り直してある。設計の狙い（**面が 2 枚あるときの食い違い**）はそのまま。
 *
 * **何を疑っているか** — 入口が片面だけになっていないか。仕様 `cockpit-home.md` の 6 項は
 * 「`view/title` と `editor/title` の**両方**。全画面はサイドバーごと畳むので、片方だけだと
 * 入口がゼロになる」と決めている。ところが回帰ケース 65（`65-home-back.mjs`）は
 * **サイドバーの面しか見ていない**。タブの面で一覧が開かない／← が出ない／← で戻れないなら、
 * 全画面のときに一覧へ入る道が消える。ここはその穴を塞ぐ。
 *
 * **なぜ落ちうるか** — `nimbus.openHome`（`extensions/nimbus/src/extension.ts:4027-4037`）は
 * `cockpit.reveal()` のあと `cockpit.post({ type: 'home', …, open: true })` を呼ぶ。
 * `post` は `WebviewViewHost.ts:166-169` で view と panel の**両方**へ配るので、
 * タブの面にも届く**はず**。届いていなければ入口は片面だけになっている。
 * 逆に `#homeBack`（`media/cockpit.js:962-963`）は `setHomeOpen(false)` を自分の面にだけ効かせる。
 *
 * **決まったので判定へ格上げした（T-356・利用者 2026-08-31）** — 「片方の面を開き直すと、
 * 触っていないもう片方の Home が閉じる」は、仕様が「provider が覚える」と書いたままで
 * 面ごとに持つのかが決まっていなかったため、以前はここで観察して `console.log` に
 * 残すだけにしていた。**一覧の開閉は面ごとに持つ**と決まったので、本丸③で落とす。
 * 壊れかたは「provider に 1 個しかない `homeOpen` を `ready` の返事で両面へ配る」形で、
 * **面が 2 枚ないと出ない** — だからここが唯一の守り（モジュールテストでは出せない）。
 *
 * 課金しない: Enter・送信・開始は押さない。ネイティブモーダルへ至る操作もしない。
 */
import { labels, openNimbusSidebar, runCommand } from '../helpers.mjs';

/** `nimbus.openHome` のタイトルは nls を通していない素の日本語（package.json:643-647） */
const OPEN_HOME = 'セッションの一覧（Home）を開く';

/**
 * 指定した「部」の中にあるコックピットのフレームを掴む。
 *
 * サイドバーとタブで**同じ id**（`#sessionTabs` / `#home`）を持つ面が同時に生きるので、
 * id だけで選ぶと 2 枚目を掴む（T-329 の形）。矩形の重なりで面を見分ける。
 * 座標の取りかたは 63-rail-sash.mjs:14-18 と同じ（`frameElement().boundingBox()` は
 * 入れ子でもページ座標を返す）。
 */
async function frameInPart(page, partSelector, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		const rect = await page.evaluate((selector) => {
			const el = document.querySelector(selector);
			if (!el) {
				return undefined;
			}
			const box = el.getBoundingClientRect();
			return { x: box.x, y: box.y, w: box.width, h: box.height };
		}, partSelector);
		if (rect && rect.w > 0 && rect.h > 0) {
			for (const frame of page.frames()) {
				try {
					if (!(await frame.$('#homeBack'))) {
						continue;
					}
					const box = await (await frame.frameElement()).boundingBox();
					if (!box || box.width <= 0) {
						continue;
					}
					const cx = box.x + box.width / 2;
					const cy = box.y + box.height / 2;
					if (cx >= rect.x && cx <= rect.x + rect.w && cy >= rect.y && cy <= rect.y + rect.h) {
						return frame;
					}
				} catch {
					// フレームが入れ替わっている最中。次の周で拾う
				}
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/**
 * 開いているタブを閉じる（×）。開いた面を残すと、後のケースが 2 枚目を掴む（T-329）。
 * 本丸③（タブを開き直す）と後始末の両方で使う。
 */
async function closeOpenTabs(page) {
	for (let i = 0; i < 3; i++) {
		const closed = await page
			.evaluate(() => {
				const button = document.querySelector('.tabs-container .tab .codicon-close, .tabs-container .tab .tab-close');
				if (!button) {
					return false;
				}
				button.click();
				return true;
			})
			.catch(() => false);
		if (!closed) {
			break;
		}
		await page.waitForTimeout(500);
	}
}

/** その面が今どう見えているか。`hidden` は `setHomeOpen` が両方まとめて動かす（cockpit.js:1009-1013） */
function look(frame) {
	return frame.evaluate(() => {
		const back = document.getElementById('homeBack');
		const home = document.getElementById('home');
		const log = document.getElementById('log');
		return {
			backShown: Boolean(back) && !back.hidden,
			homeOpen: Boolean(home) && !home.hidden,
			logShown: Boolean(log) && !log.hidden
		};
	});
}

/** 一覧を開いているあいだだけ ← が出る（仕様 cockpit-home.md 6 項）。両者がずれたら壊れている */
function consistent(state) {
	return state.homeOpen === state.backShown;
}

const describe = (state) =>
	`一覧=${state.homeOpen ? '開' : '閉'} / ←=${state.backShown ? '有' : '無'} / 会話=${state.logShown ? '見' : '隠'}`;

export default {
	name: 'タブの面でも一覧が開き、← で会話へ戻れる（入口が片面だけになっていない）',
	adversarial: true,
	async run(page, ctx) {
		let tabOpened = false;
		try {
			ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
			await page.waitForTimeout(800);

			const side = await frameInPart(page, '.part.sidebar');
			ctx.expect(side !== undefined, 'サイドバーのコックピットが見つからない（#homeBack を持つ面が無い）');

			// タブの面を出す。ここから先の主張はすべて**タブの面**について
			await runCommand(page, labels('command.openCockpitTab')[0]);
			tabOpened = true;
			await page.waitForTimeout(2500);

			const tab = await frameInPart(page, '.part.editor');
			ctx.expect(
				tab !== undefined,
				'コックピットをタブで開いたのに、エディタの部にコックピットの面が無い（タブが開いていないか、面が別の部に出ている）'
			);

			// 会話を見ている状態へ正規化する。前のケースが一覧を開いたまま返している場合に備える
			let tabState = await look(tab);
			if (tabState.homeOpen) {
				await tab.evaluate(() => document.getElementById('homeBack')?.click());
				await page.waitForTimeout(700);
				tabState = await look(tab);
			}
			ctx.expect(
				!tabState.homeOpen,
				`タブの面を会話の状態にできない（← を押しても一覧が閉じない）: ${describe(tabState)}`
			);
			ctx.expect(
				consistent(tabState),
				`会話を見ているのに ← が出ている（仕様 cockpit-home.md 6 項「一覧を開いているときだけ出す」）: ${describe(tabState)}`
			);

			// ── 本丸①: タブの面で一覧が開くか ───────────────────────────────
			await runCommand(page, OPEN_HOME);
			await page.waitForTimeout(1800);

			const opened = await look(tab);
			ctx.expect(
				opened.homeOpen,
				`「${OPEN_HOME}」を押しても、タブの面の一覧が開かない — 全画面はサイドバーごと畳むので、` +
					`ここが開かないと入口がゼロになる（cockpit-home.md 6 項）: ${describe(opened)}`
			);
			ctx.expect(
				consistent(opened),
				`一覧が開いたのに ← が出ていない（押して戻る道が無い）: ${describe(opened)}`
			);

			// ── 本丸②: タブの面の ← で会話へ戻れるか ─────────────────────────
			await tab.evaluate(() => document.getElementById('homeBack')?.click());
			await page.waitForTimeout(900);

			const back = await look(tab);
			ctx.expect(
				!back.homeOpen && back.logShown,
				`タブの面で ← を押しても会話へ戻らない: ${describe(back)}`
			);
			ctx.expect(
				consistent(back),
				`会話へ戻ったのに ← が出たまま（押しても何も起きないボタンが残る）: ${describe(back)}`
			);

			// ── 本丸③: タブを開き直しても、触っていない面の一覧は動かない（T-356）──
			// いまサイドバーは「一覧」（`nimbus.openHome` はどの面でも開くので、ここは正しい）、
			// タブは「会話」（②で戻した）。この食い違ったままタブを開き直すと、
			// 新しい面が送る `ready` の返事が両面へ配られていた頃は、
			// **触っていないサイドバーまで会話へ戻っていた**。開閉は面ごとに持つ（T-356）
			const sideBefore = await look(side).catch(() => undefined);
			ctx.expect(sideBefore !== undefined, 'サイドバーの面が読めない（面が作り直された可能性）');
			// ③ が意味を持つのは、2 枚の面が**食い違っている**ときだけ。サイドバーまで会話に
			// なっていると、crosstalk が直っていなくても後の比較が通ってしまう（判定が空回りする）。
			// `nimbus.openHome` はどの面でも一覧を開くので、ここは開いているのが正しい
			ctx.expect(
				sideBefore.homeOpen,
				`「${OPEN_HOME}」がサイドバーの面まで届いていない（post は両方の面へ配るはず・` +
					`WebviewViewHost.ts:166-169）。この状態では本丸③が空回りする: ${describe(sideBefore)}`
			);
			ctx.expect(
				consistent(sideBefore),
				`サイドバーの面で 一覧 と ← がずれている: ${describe(sideBefore)}`
			);

			await closeOpenTabs(page);
			tabOpened = false;
			await page.waitForTimeout(900);
			await runCommand(page, labels('command.openCockpitTab')[0]);
			tabOpened = true;
			await page.waitForTimeout(2500);

			const sideAfter = await look(side).catch(() => undefined);
			ctx.expect(sideAfter !== undefined, 'タブを開き直したら、サイドバーの面が読めなくなった');
			ctx.expect(
				sideBefore.homeOpen === sideAfter.homeOpen,
				`タブを開き直しただけで、触っていないサイドバーの面が動いた（一覧の開閉は面ごとに持つ・T-356）: ` +
					`${describe(sideBefore)} → ${describe(sideAfter)}`
			);
			ctx.expect(
				consistent(sideAfter),
				`サイドバーの面で 一覧 と ← がずれている: ${describe(sideAfter)}`
			);
		} finally {
			// タブを閉じる。開いた面を残すと、後のケースが 2 枚目を掴む（T-329）
			if (tabOpened) {
				await closeOpenTabs(page);
			}
			// サイドバーの面を「会話」に戻して終える。一覧を開いたまま返すと、
			// 次のケースが「一覧しか見えない面」を掴む（54-new-session-draft.mjs:129-131 の実測と同じ罠）
			try {
				const side = await frameInPart(page, '.part.sidebar', { attempts: 4 });
				if (side) {
					const state = await look(side);
					if (state.homeOpen) {
						await side.evaluate(() => document.getElementById('homeBack')?.click());
						await page.waitForTimeout(600);
					}
				}
			} catch (error) {
				console.log(`      ！後始末: サイドバーの面を会話へ戻せませんでした（${error instanceof Error ? error.message : String(error)}）`);
			}
			// 焦点を webview の外へ。残すと次の runCommand が再試行で時間を食う
			await page.click('.part.statusbar', { position: { x: 5, y: 5 } }).catch(() => undefined);
		}
	}
};
