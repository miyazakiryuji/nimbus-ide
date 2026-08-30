/**
 * 敵対的試験（T-345）: 「全画面にする」を 1 tick で 2 回押したら、ちゃんと戻る。
 *
 * **疑っている壊れかた** — `toggleFullscreenCockpit` は旗（`cockpitFullscreen`）を**読んでから
 * 書くまで**に、`cockpit.openInEditor(...)` と 3 つの `await executeCommand`
 * （`closeSidebar` / `closePanel` / `closeAuxiliaryBar`）を挟んでいる。
 * 先に旗を立てるガードが無く、ハンドラは最初の await で必ず一度譲るので、
 * 1 tick の 2 連打は**両方が「まだ全画面ではない」を読み、両方が入る側の枝を走る**。
 * 結果、2 回押したのにサイドバーが畳まれたまま戻らない
 * （`src/extension.ts:2686-2714` の旗の書き込みは 2688 と 2703 の 2 か所だけ）。
 *
 * **期待する振る舞い** — 2 回押したあと、サイドバーが見えている。
 *
 * 押しかたは**面のタイトルのボタンを 1 回の `page.evaluate` の中で 2 回**（`el.click(); el.click();`）。
 * await を挟むと隙間が閉じて攻撃にならない。名前は `labels('command.fullscreenCockpit')` で引く
 * （`'全画面'` の決め打ちは英語ロケールで落ちる）。コマンドは `navigation` グループなので
 * `…` の裏には隠れない（`package.json:1360-1364` / `1485-1489`）。
 *
 * **入れない判定**: `cockpitTab <= 1` は入れない — `openInEditor` の先頭に
 * `if (this.panel) { reveal(); return; }` の同期ガードがあり（`src/webview/WebviewViewHost.ts:56-59`）、
 * 絶対に落ちない飾りの判定になる。押した回数も枚数も数えない。
 * ただし**タブが出たかどうか**は見る — 押しても何も起きていないのに
 * 「サイドバーが見えている」で緑にすると、飾りを通したことになるため（上限ではなく到達の裏取り）。
 *
 * 課金しない: 押すのは全画面のボタンだけ（`+`＝新しいセッションには触れない）。
 *
 * 根拠: `extensions/nimbus/src/extension.ts:549, 2686, 2688-2714, 4063` /
 * `extensions/nimbus/package.json:660-664, 1360-1364, 1485-1489` /
 * `extensions/nimbus/src/webview/WebviewViewHost.ts:56-59` /
 * 既存ケース `cases/46-fullscreen-and-side.mjs:10-19` / `cases/54-new-session-draft.mjs:16-30`
 */
import { labels, openNimbusSidebar, runCommand } from '../helpers.mjs';

/**
 * サイドバーが見えているか（`cases/46-fullscreen-and-side.mjs:10-19` をそのまま写す）。
 * `getBoundingClientRect().width` だけだと畳まれた面を拾い違える。
 */
async function sidebarVisible(page) {
	return page.evaluate(() => {
		const part = document.querySelector('.part.sidebar');
		if (!part) {
			return false;
		}
		const style = window.getComputedStyle(part);
		return style.display !== 'none' && style.visibility !== 'hidden' && part.clientWidth > 0;
	});
}

/** 失敗メッセージへ入れる実測値（見えない理由がどれなのかを残す） */
async function sidebarMetrics(page) {
	return page.evaluate(() => {
		const part = document.querySelector('.part.sidebar');
		if (!part) {
			return '.part.sidebar が無い';
		}
		const style = window.getComputedStyle(part);
		return `display=${style.display} visibility=${style.visibility} clientWidth=${part.clientWidth}px`;
	});
}

/** いま開いているエディタタブの名前（判定には使わない。失敗の理由を読むための実測値） */
async function tabTitles(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.tabs-container .tab')]
			.map((el) => (el.innerText ?? '').replace(/\s+/g, ' ').trim())
			.join(' | ')
	);
}

/**
 * コックピットのタブが並んでいるか。**枚数は数えない**（`extension.ts:2694` の題は
 * `Nimbus コックピット` 固定。将来英語になっても拾えるように両方見る）。
 */
async function cockpitTabPresent(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.tabs-container .tab')].some((el) => {
			const text = (el.innerText ?? '').replace(/\s+/g, ' ');
			return text.includes('コックピット') || text.includes('Cockpit');
		})
	);
}

export default {
	name: '「全画面にする」の 1 tick 2 連打でも、サイドバーは戻る（敵対）',
	adversarial: true,
	async run(page, ctx) {
		/** 本体を通り切ったか（finally で本来の失敗理由を上書きしないための印） */
		let bodyDone = false;
		try {
			ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない（連打を始める前提が崩れている）');
			await page.waitForTimeout(1200);
			ctx.expect(
				await sidebarVisible(page),
				`連打の前からサイドバーが見えていない: ${await sidebarMetrics(page)}`
			);

			// 連打の前にタブの有無を控える（あとで「コマンドまで届いた」を裏取りするため）
			const hadCockpitTab = await cockpitTabPresent(page);

			// 1 回の evaluate の中で 2 回押す。await を挟むと隙間が閉じて攻撃にならない
			const burst = await page.evaluate((names) => {
				const seen = [];
				const found = [
					...document.querySelectorAll(
						'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
					)
				].find((el) => {
					const name = `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`;
					seen.push(name.replace(/\s+/g, ' ').trim());
					return names.some((candidate) => name.includes(candidate));
				});
				if (!found) {
					return { clicked: false, seen };
				}
				found.click();
				found.click();
				return { clicked: true, seen };
			}, labels('command.fullscreenCockpit'));
			ctx.expect(
				burst.clicked,
				`面のタイトルに「${labels('command.fullscreenCockpit').join(' / ')}」のボタンが無い（押せた回数 0）。並んでいた名前: ${
					burst.seen.filter((name) => name).join(' | ') || '（なし）'
				}`
			);

			// 全画面は openInEditor →3 つの closeXxx と続くので、落ち着くまで待ってから見る
			await page.waitForTimeout(3000);
			let visible = await sidebarVisible(page);
			for (let i = 0; i < 4 && !visible; i++) {
				await page.waitForTimeout(800);
				visible = await sidebarVisible(page);
			}
			await ctx.shot('adv-15-fullscreen-burst');

			// **押した結果がコマンドまで届いた裏取り。** 届いていないのに
			// 「サイドバーが見えている」で緑にすると、飾りを通したことになる
			// （どちらの枝でも 1 回目のうちに `openInEditor` が走り、タブが出る）。
			// 節の「入れない判定」は**枚数の上限**（`cockpitTab <= 1`）の話で、
			// ここで見るのは**出たかどうか**。押しても何も起きなければ落ちる
			if (hadCockpitTab) {
				console.log('  ！ 連打の前からコックピットのタブが開いていました（到達の裏取りは弱め）');
			} else {
				ctx.expect(
					await cockpitTabPresent(page),
					`2 連打がコマンドまで届いていない（コックピットのタブが出ない）。開いているタブ: ${
						(await tabTitles(page)) || '（なし）'
					}`
				);
			}

			ctx.expect(
				visible,
				`「全画面にする」を 1 tick で 2 回押したのにサイドバーが戻らない（2 回目も「入る」枝を走った疑い）。サイドバー: ${await sidebarMetrics(
					page
				)} / 開いているタブ: ${(await tabTitles(page)) || '（なし）'}`
			);
			bodyDone = true;
		} finally {
			// **後始末は旗に依存しない収束ループ**にする。旗がどちらに倒れていても 2 周以内に開く
			try {
				for (let i = 0; i < 4 && !(await sidebarVisible(page)); i++) {
					await runCommand(page, labels('command.fullscreenCockpit')[0]);
					await page.waitForTimeout(1200);
				}
				if (!(await sidebarVisible(page))) {
					// それでも戻らなければ、アクティビティバーから開き直す
					await openNimbusSidebar(page);
					await page.waitForTimeout(800);
				}
			} catch (error) {
				console.log(`  ！ サイドバーを開き直せませんでした: ${error?.message ?? error}`);
			}

			// 全画面が開いた**コックピットのタブだけ**を閉じる（✕ を実マウスで押す。和音は待ち状態が残る）。
			// **名前で選ぶ** — 手当たり次第に閉じると、前のケースが残した無題の文書に当たって
			// ネイティブの保存ダイアログが出る（出た瞬間に束が丸ごと死ぬ）。
			// 押せないときは既定の 30 秒待ちで 1 ケース 60 秒を食い潰すので、短い待ちで諦める
			try {
				for (let i = 0; i < 3; i++) {
					let closed = false;
					for (const tab of await page.$$('.tabs-container .tab')) {
						const text = await tab.evaluate((el) => el.innerText ?? '').catch(() => '');
						if (!text.includes('コックピット') && !text.includes('Cockpit')) {
							continue;
						}
						const closer = await tab.$('.codicon-close, .tab-close');
						if (!closer) {
							continue;
						}
						closed = await closer.click({ timeout: 3000 }).then(
							() => true,
							(error) => {
								console.log(`  ！ コックピットのタブの ✕ を押せませんでした: ${error?.message ?? error}`);
								return false;
							}
						);
						await page.waitForTimeout(500);
						break;
					}
					if (!closed) {
						break;
					}
				}
			} catch (error) {
				console.log(`  ！ 開いたタブを閉じられませんでした: ${error?.message ?? error}`);
			}

			// 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）。
			// `.part.activitybar` の中心はアイコンに当たるので、ステータスバーを位置指定で押す
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(300);

			// サイドバーが閉じたまま抜けると**後続の全ケースがタイトルのボタンを掴めなくなる**ので、
			// ここだけは落として知らせる。ただし**本体が既に落ちているときは投げない** —
			// 本来の失敗理由が消えるほうが高くつく（共通の掟 6）
			const restored = await sidebarVisible(page);
			if (bodyDone) {
				ctx.expect(restored, `後始末でサイドバーを戻せなかった: ${await sidebarMetrics(page)}`);
			} else if (!restored) {
				console.log(`  ！ 後始末でサイドバーを戻せませんでした: ${await sidebarMetrics(page)}`);
			}
		}
	}
};
