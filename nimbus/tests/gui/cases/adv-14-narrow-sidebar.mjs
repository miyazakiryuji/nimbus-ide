/**
 * 敵対的試験（T-345）— サイドバーを最小幅まで引き切っても、会話と入力欄が残る。
 *
 * **疑っている壊れかた**: 仕様は「列 150px・会話 200px は必ず残す。どちらかが消えると、
 * そこに何があったか分からなくなる」と書いている（`nimbus/docs/specs/cockpit-home.md:57`）。
 * ところが守っているのは**掴み代を引いたときだけ** — `railBounds()` / `applyRailWidth()` は
 * 境目の操作から呼ばれる経路にしかいない（`extensions/nimbus/media/cockpit.js:1195-1217`）。
 * 面そのものが狭くなる道は CSS だけで、列は `flex: 0 0 auto` ＋ `width: clamp(200px, 40%, 300px)`
 * で**縮まず**（`extensions/nimbus/media/cockpit.css:79-98`）、会話側の `.cockpit-main` は
 * `min-width: 0` で 0 まで潰れる（同 `:65-67`）。
 * 一方サイドバーの最小幅は 170px（`src/vs/workbench/browser/parts/sidebar/sidebarPart.ts:44`）で、
 * 150+200+4=354px を大きく下回る。既定幅は 560px まで広げてある
 * （`src/vs/workbench/browser/layout.ts:162, 3016-3018, 3117-3122`）が、**狭める側に下限は無い**。
 * T-341 で「狭い面では列を畳む」旧実装が消えているので、いま狭い面は無防備。
 *
 * **なぜ落ちうるか**: 会話が 0px になると、読む場所も送る場所も無い面が残る。
 * 縦に割って使う人・ノート PC の実寸では珍しくない引きかたで、そこに入口があること自体が消える。
 *
 * **期待するのは「会話と入力欄が消えないこと」だけ。** 185px では 150+200+4 を物理的に
 * 満たせないので、「列のほうが譲る」「列を畳む」のどちらを採るかは**試験では決めない**。
 * 失敗メッセージに 列 / 会話 / サイドバーの実測 px を全部載せ、直す側が選べるようにする。
 *
 * **前提は「狭める前に列が出ていること」。** 列は 2 本目のセッションから出る
 * （`extensions/nimbus/media/cockpit.js:1305`）。畳まれている間は `.session-tabs[hidden]`
 * が `width: auto`（同 css:143-145 の隣、`:100-102`）＝ ≡ の幅しか取らないので、
 * 狭めても会話は潰れず**何も確かめないまま緑になる**。足りなければ自分で足し、
 * それでも出なければ「前提が作れなかった」で落とす（偽の緑を作らない）。
 * 足すのは下書き 1 枚（`extensions/nimbus/src/extension.ts:3609-3616`）で、
 * プロセスは立たない ＝ 課金しない。
 *
 * 課金しない: 入力欄には触れず、送信も Enter も押さない（当たり判定を測るだけ）。
 * ネイティブのモーダルにも触れない。
 *
 * 根拠: `extensions/nimbus/media/cockpit.js:1195-1217` /
 * `extensions/nimbus/media/cockpit.css:65-67, 79-98` /
 * `src/vs/workbench/browser/parts/sidebar/sidebarPart.ts:44` /
 * `src/vs/workbench/browser/layout.ts:162, 3016-3018, 3117-3122` /
 * `nimbus/docs/specs/cockpit-home.md:57` / 既存ケース `cases/63-rail-sash.mjs:12-24`
 */
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

/** サイドバーの面の寸法。`client` が 0 なら「畳まれた＝測れない」 */
async function sidebarBox(page) {
	return page.evaluate(() => {
		const part = document.querySelector('.part.sidebar');
		if (!part) {
			return null;
		}
		const r = part.getBoundingClientRect();
		return {
			x: Math.round(r.x),
			right: r.right,
			width: Math.round(r.width),
			client: part.clientWidth
		};
	});
}

/**
 * サイドバーの右端にある境目（`.monaco-sash`）の中心。
 *
 * `.disabled` は掴めないので外し、**縦**（`vertical`）だけを見る
 * （`src/vs/base/browser/ui/sash/sash.ts:288, 474-478`）。
 * 盤面には編集領域・パネルの境目も並ぶので、**中心 x がサイドバーの右端 ±8px** のものだけを選ぶ。
 */
async function sidebarSash(page, rightEdge) {
	return page.evaluate((edge) => {
		let best = null;
		for (const el of document.querySelectorAll('.monaco-sash')) {
			if (el.classList.contains('disabled') || !el.classList.contains('vertical')) {
				continue;
			}
			const r = el.getBoundingClientRect();
			if (r.width <= 0 || r.height <= 0) {
				continue;
			}
			const cx = r.x + r.width / 2;
			const gap = Math.abs(cx - edge);
			if (gap > 8) {
				continue;
			}
			if (!best || gap < best.gap) {
				best = { gap, x: cx, y: r.y + r.height / 2 };
			}
		}
		return best;
	}, rightEdge);
}

/**
 * **サイドバーの中にある**コックピットの webview と、その画面上の原点。
 *
 * `#input` だけで掴むと、全画面（エディタタブ）のコックピットが生きているとき
 * そちらを測ってしまい、狭めていない面を見て緑になる（T-329/T-340 の形）。
 * 中心 x がサイドバーの中に入っているものだけを認める。
 */
async function cockpitInSidebar(page, sidebar, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				const isCockpit = await frame.evaluate(() =>
					Boolean(document.getElementById('input') && document.querySelector('.cockpit-main'))
				);
				if (!isCockpit) {
					continue;
				}
				const box = await (await frame.frameElement()).boundingBox();
				if (!box || box.width <= 0) {
					continue;
				}
				const cx = box.x + box.width / 2;
				if (cx < sidebar.x || cx > sidebar.right) {
					continue;
				}
				return { frame, origin: box };
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/**
 * 列・会話・入力欄・送信ボタンの実測。
 *
 * 「在る」ではなく**押せる場所に在る**まで見る。`inView` は面の中に収まっていること、
 * `hit` は送信ボタンの中心を突いたときに送信ボタン自身が返ること
 * （幅 0 に潰れると別の要素が返る／null になる）。
 */
async function measure(frame) {
	return frame.evaluate(() => {
		const round = (n) => Math.round(n);
		const rect = (el) => (el ? el.getBoundingClientRect() : null);
		const rail = document.querySelector('.session-tabs');
		const main = document.querySelector('.cockpit-main');
		const input = document.getElementById('input');
		const send = document.getElementById('send');
		const sash = document.getElementById('railSash');
		const railBox = rect(rail);
		const mainBox = rect(main);
		const inputBox = rect(input);
		const sendBox = rect(send);
		const sashBox = rect(sash);
		const inside = (b) =>
			Boolean(b) &&
			b.width > 0 &&
			b.height > 0 &&
			b.left >= -1 &&
			b.top >= -1 &&
			b.right <= window.innerWidth + 1 &&
			b.bottom <= window.innerHeight + 1;

		let hit = false;
		let hitTag = '送信ボタンが無い';
		if (send && sendBox && sendBox.width > 0 && sendBox.height > 0) {
			const at = document.elementFromPoint(
				sendBox.left + sendBox.width / 2,
				sendBox.top + sendBox.height / 2
			);
			hit = Boolean(at) && (at === send || send.contains(at) || at.closest('#send') !== null);
			if (!at) {
				hitTag = 'null（面の外）';
			} else {
				const cls = at.getAttribute('class') ?? '';
				hitTag = `${at.tagName.toLowerCase()}${at.id ? `#${at.id}` : ''}${
					cls ? `.${cls.trim().split(/\s+/).join('.')}` : ''
				}`.slice(0, 60);
			}
		} else if (sendBox) {
			hitTag = `潰れている（${round(sendBox.width)}x${round(sendBox.height)}）`;
		}

		return {
			rail: railBox ? round(railBox.width) : 0,
			railHidden: rail ? rail.hidden : true,
			main: mainBox ? round(mainBox.width) : 0,
			input: inputBox ? `${round(inputBox.width)}x${round(inputBox.height)}` : 'なし',
			send: sendBox ? `${round(sendBox.width)}x${round(sendBox.height)}` : 'なし',
			view: `${round(window.innerWidth)}x${round(window.innerHeight)}`,
			inView: inside(inputBox) && inside(sendBox),
			hit,
			hitTag,
			// 覚えた幅を捨てるためのダブルクリック先（畳んでいるときは掴めない）
			sash: sashBox ? { visible: Boolean(sash) && !sash.hidden && sashBox.width > 0, x: sashBox.x + sashBox.width / 2, y: sashBox.y + sashBox.height / 2 } : null
		};
	});
}

/**
 * 境目を本物のマウスで `toX` まで引く。
 * **`down()` したまま落ちると以後の全ケースが壊れる**ので、`up()` は finally で必ず通す。
 */
async function dragTo(page, from, toX) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	try {
		await page.mouse.move(toX, from.y, { steps: 12 });
	} finally {
		await page.mouse.up();
	}
	await page.waitForTimeout(600);
}

export default {
	name: 'サイドバーを最小幅まで引き切っても、会話と入力欄が残る',
	adversarial: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

		let wide = await sidebarBox(page);
		ctx.expect(
			wide !== null && wide.client > 0,
			`サイドバーの面が見つからない（畳まれている）: ${JSON.stringify(wide)}`
		);

		let view = await cockpitInSidebar(page, wide);
		ctx.expect(
			view !== undefined,
			`サイドバー（x=${wide.x}〜${Math.round(wide.right)}px）の中にコックピット（#input）が見つからない`
		);

		// --- 前提づくり ---
		// 列が畳まれたまま狭めても会話は潰れないので、それでは何も確かめないまま緑になる。
		// 列は 2 本目のセッションから出る。足りなければ下書きを足して出す（63 と同じ手）
		let before = await measure(view.frame);
		for (let i = 0; i < 2 && before.railHidden; i++) {
			await runCommand(page, '新しいセッション');
			await page.waitForTimeout(800);
			wide = (await sidebarBox(page)) ?? wide;
			view = (await cockpitInSidebar(page, wide, { attempts: 6 })) ?? view;
			before = await measure(view.frame);
		}
		ctx.expect(
			!before.railHidden && before.rail > 0,
			'前提が作れなかった: セッションの列が出ないので、狭めても会話は潰れない' +
				`（列=${before.rail}px・畳み=${before.railHidden}）。このケースは何も確かめていない`
		);
		ctx.expect(
			before.hit && before.inView,
			'前提が作れなかった: 狭める前から入力欄が押せる場所に無い' +
				`（会話=${before.main}px / 送信=${before.send}・中心の当たり=${before.hitTag}・面の中=${before.inView} / ` +
				`サイドバー=${wide.width}px・webview ${before.view}）`
		);

		const sash = await sidebarSash(page, wide.right);
		ctx.expect(
			sash !== null,
			`サイドバーの境目（.monaco-sash.vertical）が見つからない: 右端=${Math.round(wide.right)}px`
		);
		const homeX = sash.x;

		let narrow;
		let narrowSidebar;
		try {
			// **覚えた幅を先に捨てる。** 前のケースが広げたままだと、見ているのは
			// 「覚えた幅の押し込み」であって CSS の下限ではなくなる（63 の教訓）。
			// 列を畳んでいるときは掴み代そのものが無いので、そのまま進む
			if (before.sash?.visible) {
				await page.mouse.dblclick(view.origin.x + before.sash.x, view.origin.y + before.sash.y);
				await page.waitForTimeout(500);
				// 捨てたあとが本当の「狭める前」。ここを測り直さないと、
				// 失敗メッセージの「狭める前」が覚えていたころの数字のままになる
				before = await measure(view.frame);
			}

			// **残った選択の上で mousedown すると、選択のドラッグ＆ドロップが始まって
			// サッシが動かない。** これを製品の不具合と読み違えかけた（61 の実測）
			await view.frame.evaluate(() => window.getSelection()?.removeAllRanges());

			// 最小幅は 170px。**そこを下回るところまで引かない** — VS Code のスナップで
			// サイドバーごと畳まれ、面が消えて何も測れなくなる
			await dragTo(page, sash, wide.x + 185);

			narrowSidebar = await sidebarBox(page);
			// 「畳まれた」を「入力欄が消えた」と誤読しないための関門
			ctx.expect(
				narrowSidebar !== null && narrowSidebar.client > 0,
				'サイドバーごと畳まれてしまい、狭い面を測れない（このケースは何も確かめていない）: ' +
					`${JSON.stringify(narrowSidebar)} / 狭める前=${wide.width}px`
			);

			narrow = await measure(view.frame);
			await ctx.shot('adv-14-narrow-sidebar');

			// --- 本命 ---
			// 判定は「会話と入力欄が消えないこと」だけ。`>= 200` は書かない
			// （185px の面で 150+200+4 は物理的に満たせない）。直しかたは実装者が決める
			ctx.expect(
				narrow.main > 0 && narrow.hit && narrow.inView,
				'サイドバーを狭めると、会話と入力欄が消える: ' +
					`列=${narrow.rail}px（畳み=${narrow.railHidden}） / 会話=${narrow.main}px / ` +
					`サイドバー=${narrowSidebar.width}px（webview ${narrow.view}） / ` +
					`入力欄=${narrow.input} / 送信=${narrow.send}（中心の当たり=${narrow.hitTag}・面の中=${narrow.inView}） / ` +
					`狭める前: 列=${before.rail}px 会話=${before.main}px サイドバー=${wide.width}px`
			);
		} finally {
			// 狭いままだと以後のケースが全部「狭い面」を見ることになる。必ず元の x へ引き戻す。
			// finally の中では ctx.expect を投げない（本来の失敗理由が消える）
			try {
				const now = await sidebarBox(page);
				const back = now ? await sidebarSash(page, now.right) : null;
				if (back) {
					await dragTo(page, back, homeX);
				} else {
					console.log('  ！ adv-14: 戻すための境目を掴み直せませんでした');
				}
				const after = await sidebarBox(page);
				console.log(
					`  adv-14: サイドバー ${wide.width}px → ${narrowSidebar?.width ?? '?'}px → ${after?.width ?? '?'}px / ` +
						`会話 ${before.main}px → ${narrow?.main ?? '?'}px / 列 ${before.rail}px → ${narrow?.rail ?? '?'}px`
				);
			} catch (error) {
				console.log(`  ！ adv-14 の後始末に失敗しました: ${error?.message ?? error}`);
			}
		}
	}
};
