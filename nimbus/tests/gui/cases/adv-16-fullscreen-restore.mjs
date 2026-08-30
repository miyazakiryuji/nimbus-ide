/**
 * 敵対的試験（T-345）— 順番と持ち越し: 全画面をやめたら、必ず元の見えかたへ戻る。
 *
 * **この束では最後に置く。** `cockpitFullscreen`（`extensions/nimbus/src/extension.ts:549`）は
 * 拡張ホスト側の内部フラグで、ランナーの `resetWorkbench`（タブを閉じるだけ）では戻らない。
 * 全画面のコマンドを奇数回押して終えると、次のケースの 1 押し目が「戻す」側から始まる。
 *
 * **疑っている壊れかた** — 戻す側は真偽値 1 個を見て `workbench.action.toggleSidebarVisibility` を
 * **1 本呼ぶだけ**で、画面の実状態を見ていない（`extension.ts:2687-2691`）。
 * 行く側は `openInEditor` ＋ closeSidebar / closePanel / closeAuxiliaryBar の 3 つと非対称
 * （`extension.ts:2694-2702` / `webview/WebviewViewHost.ts:56-73`）。
 * だから全画面のあいだにサイドバーを開き直すと、「戻す」が**サイドバーを閉じる**。
 * 続けてもう一度押すと入る側へ行き、`closeSidebar` は空振りするので
 * **押しても何も起きない一手**が生まれる。
 *
 * **期待する振る舞い** — 「もう一度で戻す」は必ず元の見えかたへ戻し、そこのコックピットに打てる。
 * 途中で別の入口からサイドバーを開いても、**次の 1 押しは必ず画面を変える**。
 * ※「コックピットがどこにも見えなくなる」とは書かない —— タブは残るので、実害は
 * 「戻すが閉じるになる」非対称のほう。
 *
 * 根拠: `extensions/nimbus/src/extension.ts:549, 2686-2714` /
 * `extensions/nimbus/src/webview/WebviewViewHost.ts:56-73` /
 * `nimbus/docs/specs/cockpit-fullscreen.md`（全画面 T-269 ①） /
 * 既存ケース `cases/46-fullscreen-and-side.mjs:10-19`（サイドバーの見えかたの測りかたはここから写した） /
 * `cases/61-cockpit-selection.mjs:14-29`・`63-rail-sash.mjs:11-26`（フレームの掴みかた） /
 * `cases/42-editor-tabs.mjs:46-57`（タブの閉じかたと焦点戻し）
 */
import { labels, openNimbusSidebar, runCommand } from '../helpers.mjs';

/**
 * サイドバーの見えかた。判定は 46-fullscreen-and-side.mjs:10-19 と同じ 3 条件のまま、
 * 失敗の文言に埋める**実測値**（幅と display）を添えて返す。
 *
 * `display` は**枠（`.split-view-view`）のほうも一緒に読む**。畳まれた面は
 * 祖先の枠ごと `display:none` になるだけで、`.part.sidebar` 自身の display は `flex` のまま
 * （`src/vs/base/browser/ui/splitview/splitview.css:40-41`）。part 側だけ読むと
 * 畳まれていても `flex/visible` と出て、失敗の文言が「見えているのに落ちた」に読めてしまう。
 */
async function sidebar(page) {
	return page.evaluate(() => {
		const part = document.querySelector('.part.sidebar');
		if (!part) {
			return { visible: false, width: -1, display: 'なし' };
		}
		const style = window.getComputedStyle(part);
		const frame = part.closest('.split-view-view');
		const frameDisplay = frame ? window.getComputedStyle(frame).display : '枠なし';
		return {
			visible: style.display !== 'none' && style.visibility !== 'hidden' && part.clientWidth > 0,
			width: part.clientWidth,
			display: `${style.display}/${style.visibility}（枠=${frameDisplay}）`
		};
	});
}

/**
 * サイドバーを**見えるところまで**開き直す。
 *
 * 先に helpers の `openNimbusSidebar` を使う（アイコンのトグル罠と
 * 「Nimbus 設定 / タスク / デバッグ」の除外を持っているのはこちら・仕様の指示どおり）。
 * ただし **畳まれているときは空振りしうる**: helpers は見出しを `.part.sidebar` の
 * `innerText` で測るが（`helpers.mjs:60-70`）、畳まれた面は祖先の `.split-view-view` ごと
 * `display:none` になり、**描画されていない要素の innerText は textContent に落ちる**。
 * つまり閉じたまま「Nimbus が開いている」と読めて、アイコンを 1 度も押さない。
 * それを製品の不具合と読み違えないよう、**見えかたで確かめ直し、駄目なら雲アイコンを直接押す**
 * （除外は helpers と同じ 3 つ。タスクも除ける ——「Nimbus タスク」も `Nimbus` を含むので）。
 *
 * 畳まれている面のアイコンを押すと**開く**側へ倒れる（閉じるのは見えているときだけ）ので、
 * ここでの直接押しはトグル罠を踏まない。
 */
async function reopenSidebar(page, { attempts = 3 } = {}) {
	const excluded = [
		...labels('viewsContainers.nimbusSettings'),
		...labels('viewsContainers.nimbusTasks'),
		...labels('viewsContainers.nimbusDebug')
	];
	for (let i = 0; i < attempts; i++) {
		await openNimbusSidebar(page, { attempts: 2 }).catch(() => undefined);
		if ((await sidebar(page)).visible) {
			return true;
		}
		for (const icon of await page.$$('.activitybar [aria-label], .activitybar [title]')) {
			const name = await icon
				.evaluate((el) => `${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
				.catch(() => '');
			if (!name.includes('Nimbus') || excluded.some((skip) => name.includes(skip))) {
				continue;
			}
			await icon.click().catch(() => undefined);
			break;
		}
		await page.waitForTimeout(1200);
	}
	return (await sidebar(page)).visible;
}

/**
 * 焦点を webview の外へ戻す。押しても何も起きないところ（ステータスバーの左寄りの余白）を 1 回。
 * これをしないと、次の `runCommand` がパレットを開けずに再試行を重ね、60 秒を食い潰す。
 */
async function defocus(page) {
	await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
	await page.waitForTimeout(300);
}

/** 全画面のコマンドを 1 回押し、焦点を戻して、サイドバーの見えかたを返す */
async function pressFullscreen(page) {
	await runCommand(page, labels('command.fullscreenCockpit')[0]);
	await page.waitForTimeout(2000);
	await defocus(page);
	return sidebar(page);
}

/**
 * **サイドバーの矩形の中にいる**コックピットのフレームを返す。
 *
 * 全画面はタブ側にもう 1 枚コックピットを作る（`WebviewViewHost.openInEditor`）ので、
 * `#input` を持つフレームは 2 枚になりうる。素朴にフレームを横断すると
 * タブ側の 1 枚を掴んで「戻った先で打てた」ことにしてしまう（T-329 の汚染と同じ形）。
 * 左右で分かれているので、フレームの**横の中心**がサイドバーの幅の中に入るかで見分ける。
 */
async function cockpitInSidebar(page, { attempts = 8 } = {}) {
	let rect;
	let seen = [];
	for (let i = 0; i < attempts; i++) {
		rect = await page.evaluate(() => {
			const el = document.querySelector('.part.sidebar');
			if (!el) {
				return undefined;
			}
			const box = el.getBoundingClientRect();
			return { x: Math.round(box.x), w: Math.round(box.width) };
		});
		seen = [];
		if (rect && rect.w > 0) {
			for (const frame of page.frames()) {
				let box;
				try {
					if (!(await frame.$('#input'))) {
						continue;
					}
					box = await (await frame.frameElement()).boundingBox();
				} catch {
					continue; // フレームが入れ替わっている最中。次で拾う
				}
				if (!box) {
					continue;
				}
				const center = box.x + box.width / 2;
				seen.push(`x=${Math.round(box.x)}〜${Math.round(box.x + box.width)}`);
				if (center >= rect.x && center <= rect.x + rect.w) {
					return { frame, rect, seen };
				}
			}
		}
		await page.waitForTimeout(500);
	}
	return { frame: undefined, rect, seen };
}

export default {
	name: '全画面をやめたら、必ず元の見えかたへ戻る',
	adversarial: true,
	async run(page, ctx) {
		try {
			// 0. 状態を正規化する。**実際に見えている**ところから始めないと、
			//    前の敵対ケースが畳んだまま返しただけで 1 つめの判定が「畳まれたから成功」で素通りする
			await reopenSidebar(page);
			const start = await sidebar(page);
			ctx.expect(
				start.visible,
				`始める前にサイドバーが見えていない（この経路では何も確かめられない）: ` +
					`幅 ${start.width}px / display=${start.display}`
			);

			// 1. 全画面にすると畳まれる。**これは 46 と同じ既存の期待**（本丸ではない）。
			//    ここで落ちたら、疑っている非対称ではなく全画面そのものが壊れている
			const full = await pressFullscreen(page);
			ctx.expect(
				!full.visible,
				`【既存の期待・46-fullscreen-and-side.mjs と同じ】全画面にしてもサイドバーが畳まれない: ` +
					`幅 ${full.width}px / display=${full.display}（畳む前は ${start.width}px）`
			);

			// 2. 全画面の最中に、**別の入口から**サイドバーを開き直す。
			//    入口は helpers の `openNimbusSidebar`（トグル罠と「Nimbus 設定 / タスク / デバッグ」の
			//    除外を持っている）。畳まれているときだけ空振りしうるので、`reopenSidebar` が
			//    見えかたで確かめ直してから雲アイコンを押す（理由はその関数のコメント）
			await reopenSidebar(page);
			const reopened = await sidebar(page);
			ctx.expect(
				reopened.visible,
				`全画面の最中にサイドバーを開き直せない（この経路では本丸を試せない）: ` +
					`幅 ${reopened.width}px / display=${reopened.display}`
			);

			// 3. **本丸①** — 「もう一度で戻す」が、開き直したサイドバーを閉じてしまわないこと
			const after1 = await pressFullscreen(page);
			await ctx.shot('adv-16-fullscreen-restore');
			ctx.expect(
				after1.visible,
				`【本丸①】「もう一度で戻す」がサイドバーを**閉じた**（戻す側が画面の実状態を見ずに ` +
					`toggleSidebarVisibility を 1 本呼んでいる）: 開き直したとき ${reopened.width}px → ` +
					`戻したあと ${after1.width}px / display=${after1.display}`
			);

			// 4. 戻った先のコックピットに打てること。
			//    **測るのはここ（①の直後）。** ②はもう一度押して全画面へ入り直すので、
			//    そのあとに測るとどう直しても赤にしかならない
			const view = await cockpitInSidebar(page);
			ctx.expect(
				view.frame !== undefined,
				`戻った先のサイドバーにコックピットが居ない（タブ側しか残っていない）: ` +
					`サイドバー x=${view.rect?.x}〜${(view.rect?.x ?? 0) + (view.rect?.w ?? 0)} / ` +
					`#input を持つフレーム=[${view.seen.join(', ')}]`
			);
			// フレームが入れ替わっている最中だと `$` が投げる／null を返す。
			// **握れなかったことを判定で言う** — null のまま click して TypeError で死ぬと、
			// 「打てなかった」という本来の理由が Playwright の内部エラーに化ける
			const input = await view.frame.$('#input').catch(() => undefined);
			ctx.expect(
				Boolean(input),
				`戻った先のコックピットの入力欄（#input）を握れない（面が作り直されている最中）: ` +
					`サイドバー幅 ${(await sidebar(page)).width}px`
			);
			await input.click({ timeout: 5000 }).catch(() => undefined);
			// 打てないこと自体は下の判定で言う。ここで投げると実測値の無い失敗になる
			await input.type('adv16', { delay: 20 }).catch(() => undefined);
			await page.waitForTimeout(300);
			const typed = await input.evaluate((el) => el.value ?? '').catch(() => '');
			// 判定の前に消す。落ちたときに下書きを残さない（`ctx.expect` の後ろは実行されない）
			await input
				.evaluate((el) => {
					el.value = '';
					el.dispatchEvent(new Event('input', { bubbles: true }));
				})
				.catch(() => undefined);
			// 打ったあとは焦点が webview の中にある。次の `runCommand` の再試行で秒を溶かさないよう戻す
			await defocus(page);
			ctx.expect(
				typed.includes('adv16'),
				`戻った先のコックピットに打てない: #input の中身=${JSON.stringify(typed)} / ` +
					`サイドバー幅 ${(await sidebar(page)).width}px`
			);

			// 5. **本丸②** — 続けてもう 1 押し。押しても何も起きない一手が無いこと。
			//    非対称のままだと「閉じたサイドバーをもう一度閉じにいく」ので画面が変わらない
			const after2 = await pressFullscreen(page);
			ctx.expect(
				after1.visible !== after2.visible,
				`【本丸②】押しても画面が変わらない一手がある（戻す→入る の往復で見えかたが同じ）: ` +
					`1 押し目 ${after1.visible ? '見えている' : '畳まれている'}（${after1.width}px） → ` +
					`2 押し目 ${after2.visible ? '見えている' : '畳まれている'}（${after2.width}px）`
			);
		} finally {
			// 後始末。**finally の中では ctx.expect を投げない**（本来の失敗理由が消える）
			try {
				// 1) サイドバーを畳んだまま返さない。内部フラグは戻せないので、見えかただけでも収束させる
				await reopenSidebar(page, { attempts: 4 });
				const back = await sidebar(page);
				if (!back.visible) {
					console.log(`  ！ 後始末: サイドバーを開き直せませんでした（幅 ${back.width}px）`);
				}
				// 2) 全画面が開いたタブを ✕ で押して閉じる（42-editor-tabs.mjs と同じ理由でキーは使わない）
				for (let i = 0; i < 6; i++) {
					const closers = await page.$$(
						'.tabs-container .tab .codicon-close, .tabs-container .tab .tab-close'
					);
					if (closers.length === 0) {
						break;
					}
					await closers[0].click().catch(() => undefined);
					await page.waitForTimeout(500);
				}
				// 3) 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）
				await defocus(page);
				console.log(
					'  ！ このケースは拡張ホストの `cockpitFullscreen` を戻せません（束の最後に置くこと）'
				);
			} catch (error) {
				console.log(`  ！ 後始末に失敗しました: ${error?.message ?? error}`);
			}
		}
	}
};
