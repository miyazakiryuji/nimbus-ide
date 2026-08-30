/**
 * 敵対的試験（T-345）: 境目をキーボードで端まで振り切っても、列も会話も潰れない。
 *
 * **疑っているのは「マウスで守った経路の、隣にある無防備な入口」。**
 * `#railSash` は `tabindex="0"` で ←→（Shift で 3 倍）でも動く
 * （`src/cockpit/CockpitViewProvider.ts:454` / `media/cockpit.js:1282-1291`）のに、
 * 63（マウスのドラッグ）はこの経路を 1 度も通らない。押しっぱなしで端まで振り切ったときの
 * 丸め（`applyRailWidth` の `Math.min(max, Math.max(min, …))`・`media/cockpit.js:1210-1220`）と、
 * 面を隠して戻したときの復元（`media/cockpit.js:1313` が `savedRailWidth()` を当て直す）が崩れると、
 * 列か会話のどちらかが消えて「そこに何があったか分からない」画面になる。
 *
 * ※ 丸めは `applyRailWidth` の共通経路なので**通る見込みが高い**。これは新しい穴を掘る道具ではなく、
 * 無防備な入口に見張りを置く**回帰ガード**。だから判定は境界ちょうどではなく、
 * `getBoundingClientRect` の端数のぶんだけ離してある（63 が `>= 150` とわざと緩めているのと同じ理由）。
 *
 * 期待する振る舞い: 列は下限（150px）を、会話は下限（200px）を下回らず、入力欄と送信は押せる。
 * 面を隠して戻しても、復元されるのは**その面に収まる幅**であって、振り切った値ではない。
 *
 * 根拠: `extensions/nimbus/media/cockpit.js:1195-1217, 1268-1270, 1274-1278, 1282-1291, 1293-1297, 1306-1313` /
 * `extensions/nimbus/media/cockpit.css:143` /
 * `extensions/nimbus/src/cockpit/CockpitViewProvider.ts:454` / `nimbus/docs/specs/cockpit-home.md:58`
 */
import { labels, openNimbusSettingsSidebar, openNimbusSidebar, runCommand } from '../helpers.mjs';

/** 製品が持っている下限（`media/cockpit.js:1195, 1197`）。メッセージに出すためだけの写し */
const RAIL_MIN = 150;
const CHAT_MIN = 200;
/**
 * 判定に使う床。**境界ちょうどでは見ない** — 右へ振り切ると会話は「ちょうど下限」に着地し、
 * `getBoundingClientRect` の端数で 1px 割れる。潰れているかどうかを見たいので、下限から離す
 */
const RAIL_FLOOR = 140;
const CHAT_FLOOR = 180;

/**
 * コックピット（`#railSash` を持つフレーム）と、そのフレームの原点。
 * `visible: true` のときは**境目が出ている**フレームだけを待つ（面を戻した直後は
 * まだ `hidden` のことがあり、待たずに測ると 0 を掴む）。
 *
 * **「ゆあに聞く」（ヘルプ）も同じ HTML を使う**（`extension.ts:3621` が同じ
 * `CockpitViewProvider` を組み立てる）ので、そちらも `#railSash` を持っている。
 * 設定のサイドバーを一度でも開いた面が残っていると、掴む順番次第でヘルプのほうを掴み、
 * 「列を増やしても境目が出ない」と**誤って落ちる**。列を持たないヘルプは境目が永久に
 * `hidden` なので、入力欄の案内文でコックピットのほうだけを選ぶ（32 と同じ見分けかた）。
 */
async function cockpit(page, { attempts = 20, visible = false } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				const state = await frame.evaluate(() => {
					const sash = document.getElementById('railSash');
					if (!sash) {
						return undefined;
					}
					const input = document.getElementById('input');
					return {
						cockpit: (input?.placeholder ?? '').includes('Claude に指示'),
						hidden: sash.hidden || sash.getBoundingClientRect().width === 0
					};
				});
				if (!state || !state.cockpit || (visible && state.hidden)) {
					continue;
				}
				const box = (await (await frame.frameElement()).boundingBox()) ?? { x: 0, y: 0 };
				return { frame, origin: box };
			} catch {
				// フレームが入れ替わっている最中 / そのフレームには境目が無い。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/** 失敗したときに「どのフレームがどう見えていたか」を言うための材料 */
async function railStates(page) {
	const found = [];
	for (const frame of page.frames()) {
		try {
			const state = await frame.evaluate(() => {
				const sash = document.getElementById('railSash');
				if (!sash) {
					return undefined;
				}
				const input = document.getElementById('input');
				const where = (input?.placeholder ?? '').includes('Claude に指示') ? 'コックピット' : 'ヘルプ等';
				return `${where}: hidden=${sash.hidden} 幅=${Math.round(sash.getBoundingClientRect().width)}px`;
			});
			if (state) {
				found.push(state);
			}
		} catch {
			// 破棄されている最中のフレームは飛ばす
		}
	}
	return found.length > 0 ? found.join(' / ') : '（#railSash を持つフレームが無い）';
}

/**
 * 列・会話・面の寸法と、入力欄と送信の見えかた。境目の中心座標も返す（後始末でそこを叩く）。
 *
 * **分けている実体は `.cockpit-main`。** `.chat-list` は Home を開くと隠れて寸法が 0 になり、
 * 前のケースが Home を残していると誤って落ちる（63 の実測）。
 */
async function measure(frame) {
	return frame.evaluate(() => {
		const sash = document.getElementById('railSash');
		const box = sash ? sash.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
		const columns = sash ? sash.parentElement : undefined;
		const width = (selector) => {
			const el = document.querySelector(selector);
			return el ? Math.round(el.getBoundingClientRect().width) : -1;
		};
		const send = document.getElementById('send');
		const sendBox = send ? send.getBoundingClientRect() : undefined;
		const input = document.getElementById('input');
		const inputBox = input ? input.getBoundingClientRect() : undefined;
		return {
			rail: width('.session-tabs'),
			main: width('.cockpit-main'),
			total: columns ? Math.round(columns.clientWidth) : -1,
			sash: Math.round(box.width),
			hidden: !sash || sash.hidden || box.width === 0,
			tabs: document.querySelectorAll('.session-tab').length,
			active: document.activeElement ? document.activeElement.id || document.activeElement.tagName : '（なし）',
			input: inputBox ? { w: Math.round(inputBox.width), h: Math.round(inputBox.height) } : undefined,
			send: sendBox
				? { w: Math.round(sendBox.width), h: Math.round(sendBox.height), disabled: Boolean(send.disabled) }
				: undefined,
			x: box.x + box.width / 2,
			y: box.y + box.height / 2
		};
	});
}

/** 境目へ焦点を当てる。当たらないとキーはどこにも届かないので、当たったことまで確かめる */
async function focusSash(page, frame) {
	for (let i = 0; i < 2; i++) {
		await frame.focus('#railSash').catch(() => undefined);
		await page.waitForTimeout(200);
		const ok = await frame
			.evaluate(() => document.activeElement?.id === 'railSash')
			.catch(() => false);
		if (ok) {
			return true;
		}
		await frame.evaluate(() => document.getElementById('railSash')?.focus()).catch(() => undefined);
		await page.waitForTimeout(200);
	}
	return frame.evaluate(() => document.activeElement?.id === 'railSash').catch(() => false);
}

export default {
	name: '境目をキーボードで端まで振り切っても、列も会話も潰れない（敵対）',
	adversarial: true,
	async run(page, ctx) {
		let view;
		try {
			ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
			view = await cockpit(page);
			ctx.expect(
				view !== undefined,
				`コックピット（#railSash を持つフレーム）を掴めない: ${await railStates(page)}`
			);

			// 列が 2 本未満だと `.rail-sash[hidden]{display:none}`（cockpit.css:143）で境目は本当に消える。
			// 前のケースの持ち越しに頼らず、足りなければ下書きを足す（下書きなので課金しない）
			for (let i = 0; i < 3; i++) {
				const tabs = await view.frame
					.evaluate(() => document.querySelectorAll('.session-tab').length)
					.catch(() => 0);
				if (tabs >= 2) {
					break;
				}
				await runCommand(page, labels('command.newSession')[0]);
				await page.waitForTimeout(1200);
				view = (await cockpit(page)) ?? view;
			}

			const start = await measure(view.frame);
			ctx.expect(
				!start.hidden,
				`セッションの列を ${start.tabs} 本にしても境目が出ない（この経路では ←→ を試せない）: ` +
					`列 ${start.rail}px / 会話 ${start.main}px / 面 ${start.total}px`
			);
			// **前提**: その面に「列 150 ＋ 会話 200 ＋ 境目」が同時に入ること。入らない面では
			// 製品は列の下限を優先する（`railBounds()` の `Math.max(RAIL_MIN, …)`・cockpit.js:1200）ので、
			// 会話の下限は最初から守りようがない。ここを黙って通すと、狭い面のときに
			// 「会話が潰れた」＝製品の不具合、と誤って報告してしまう
			ctx.expect(
				start.total >= RAIL_MIN + CHAT_MIN + start.sash,
				`面が狭すぎて、この主張の前提が作れない（列 ${RAIL_MIN} ＋ 会話 ${CHAT_MIN} ＋ 境目 ${start.sash} が入らない）: ` +
					`面 ${start.total}px / 列 ${start.rail}px / 会話 ${start.main}px`
			);
			ctx.expect(
				await focusSash(page, view.frame),
				`境目に焦点が当たらない（tabindex=0 のはずが、キーの入口が無い）: activeElement=${
					(await measure(view.frame)).active
				}`
			);

			/** ←→ を連打する。`frame.press` は打鍵ごとに actionability を待って予算を溶かすので使わない */
			const press = async (key, times) => {
				for (let i = 0; i < times; i++) {
					await page.keyboard.press(key);
				}
				await page.waitForTimeout(400);
				return measure(view.frame);
			};

			// 1. 左へ振り切る（16px × 6 回 ＝ 96px。丸めは 1 回目で効くので、これで下限に着く）
			const narrow = await press('ArrowLeft', 6);
			ctx.expect(
				narrow.rail >= RAIL_FLOOR,
				`← で振り切ると列が下限（${RAIL_MIN}px）を割る: 列 ${narrow.rail}px / 会話 ${narrow.main}px / ` +
					`面 ${narrow.total}px（振り切る前は 列 ${start.rail}px）`
			);

			// 2. 右へ振り切る（16px × 10 回 ＝ 160px）。ここで潰れるのは会話のほう
			const wide = await press('ArrowRight', 10);
			ctx.expect(
				wide.main >= CHAT_FLOOR,
				`→ で振り切ると会話が潰れる: 会話 ${wide.main}px（下限 ${CHAT_MIN}px）/ 列 ${wide.rail}px / ` +
					`面 ${wide.total}px`
			);
			ctx.expect(
				wide.rail >= RAIL_FLOOR,
				`→ で振り切ったあとに列が下限（${RAIL_MIN}px）を割る: 列 ${wide.rail}px / 会話 ${wide.main}px / ` +
					`面 ${wide.total}px`
			);
			ctx.expect(
				Boolean(wide.input) && wide.input.w > 0 && wide.input.h > 0,
				`→ で振り切ると入力欄が消える: 入力欄 ${JSON.stringify(wide.input)} / 会話 ${wide.main}px / ` +
					`面 ${wide.total}px`
			);
			ctx.expect(
				Boolean(wide.send) && wide.send.w > 0 && wide.send.h > 0 && !wide.send.disabled,
				`→ で振り切ると送信が押せない: 送信 ${JSON.stringify(wide.send)} / 会話 ${wide.main}px / ` +
					`面 ${wide.total}px`
			);

			// 3. **キーが本当に効いているか。** 下限に張り付くだけなら、キーを外しても緑になってしまう。
			//    面が狭くて動く余地が無いときだけ見送る（余地は `railBounds()` と同じ式で測る）
			const room = Math.max(RAIL_MIN, start.total - CHAT_MIN - start.sash) - RAIL_MIN;
			if (room >= 30) {
				ctx.expect(
					wide.rail > narrow.rail + 20,
					`←→ を押しても境目が動かない（キーボードの入口が飾りになっている）: ` +
						`← のあと ${narrow.rail}px → → のあと ${wide.rail}px（動ける幅 ${room}px / 面 ${wide.total}px / ` +
						`activeElement=${wide.active}）`
				);
			} else {
				console.log(`  ・面に動く余地が ${room}px しか無いので、動いたかどうかの判定は見送りました`);
			}

			// 4. 面を隠して戻す。覚えた幅は**面ごとに永続する**ので、振り切った値がそのまま帰ると潰れたまま開く
			ctx.expect(await openNimbusSettingsSidebar(page), 'Nimbus 設定のサイドバーへ切り替えられない');
			await page.waitForTimeout(800);
			ctx.expect(await openNimbusSidebar(page), 'コックピットのサイドバーへ戻れない');
			const back = await cockpit(page, { visible: true });
			ctx.expect(
				back !== undefined,
				`面を戻しても、境目が出ているコックピットを掴めない（20 回×500ms 待った）: ${await railStates(page)}`
			);
			view = back;
			const restored = await measure(view.frame);
			ctx.expect(
				restored.rail >= RAIL_FLOOR && restored.main >= CHAT_FLOOR,
				`面を戻すと、その面に収まらない幅が復元される: 列 ${restored.rail}px / 会話 ${restored.main}px / ` +
					`面 ${restored.total}px（下限は 列 ${RAIL_MIN} / 会話 ${CHAT_MIN}。振り切ったときは ` +
					`列 ${wide.rail}px / 会話 ${wide.main}px）`
			);
			await ctx.shot('adv-13-rail-keyboard');
		} finally {
			// 覚えた幅を既定へ戻す。戻さないと**後続の寸法ケースを壊す**（63 の教訓）。
			// ダブルクリックは `applyRailWidth(undefined)` ＋ `rememberRailWidth(undefined)`（cockpit.js:1276-1279）
			try {
				// 途中で落ちると、別の面（Nimbus 設定）を出したまま終わることがある。
				// 覚えた幅は**面ごとに永続する**ので、ここで諦めると振り切った幅が
				// 次の寸法ケース（adv-14 の狭い面）へそのまま漏れる。1 度だけ戻して掴み直す
				if (view && (await measure(view.frame)).hidden) {
					await openNimbusSidebar(page);
					view = (await cockpit(page, { visible: true, attempts: 6 })) ?? view;
				}
				if (view) {
					const at = await measure(view.frame);
					if (at.hidden) {
						console.log('  ！ 境目が出ていないので、覚えた幅を既定へ戻せませんでした');
					} else {
						await page.mouse.dblclick(view.origin.x + at.x, view.origin.y + at.y);
						await page.waitForTimeout(600);
					}
				}
			} catch (error) {
				console.log(`  ！ 覚えた幅を既定へ戻せませんでした: ${error?.message ?? error}`);
			}
			// 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）。
			// `.part.activitybar` の中心はアイコンに当たるので、ステータスバーを位置指定で押す
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(300);
		}
	}
};
