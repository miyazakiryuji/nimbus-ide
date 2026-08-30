/**
 * 敵対的試験（T-345）— コックピットをタブで開き直しても、触っていないサイドバーの Home は閉じない。
 *
 * **疑っている壊れかた**: Home の開閉は面ごとではなく **provider に 1 個**だけ持っている
 * （`extensions/nimbus/src/cockpit/CockpitViewProvider.ts:228` の `homeOpen`）。
 * 面が `ready` を送るたびに、その 1 個を `{ type: 'home', groups, open: this.homeOpen }` として
 * 送り返すのだが（同 `:319-323`）、送り先は `WebviewViewHost.postMessage`
 * （`extensions/nimbus/src/webview/WebviewViewHost.ts:145-148`）で、**view と panel の両方へ配られる**。
 * webview 側は受け取った `open` を素直に当てる（`extensions/nimbus/media/cockpit.js:1584-1593` の
 * `setHomeOpen(message.open)`）。だから「タブ側で ≡ を閉じる → タブを閉じる → タブを開き直す」と、
 * 2 回目の `ready` が `open: false` をサイドバーへも配り、**誰も触っていない面の Home が閉じる**。
 *
 * **なぜ落ちうるか**: 見ている場所と関係ない操作で、見ていた一覧が消える。並べて使うほど踏む。
 *
 * **期待する振る舞い**: Home の開閉は**面ごとの見えかた**。別の面を開く・閉じる・開き直すことで、
 * 触っていない面の Home は動かない。面を開き直したときに戻るのは、その面自身の状態だけ。
 * ※ 仕様 `nimbus/docs/specs/cockpit-home.md`「UI 配線」は「Home の開閉は provider が覚え、
 * 面を開き直したときに戻す」と書いてある。provider ごとに持つこと自体は**書かれた設計**なので、
 * ここで見るのは「覚えること」ではなく「**覚えたものを、触っていない面へ配ること**」のほう。
 *
 * 課金しない — 下書き（実セッション無し）だけで組み立て、送信もセッション開始も押さない。
 */
import { labels, openNimbusSidebar, runCommand } from '../helpers.mjs';

/** 面のタイトルの「新しいセッション」を押す（`cases/54-new-session-draft.mjs:16-30` と同じ） */
async function pressNewSession(page) {
	return page.evaluate(() => {
		const found = [
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		].find((el) =>
			`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes('新しいセッション')
		);
		if (!found) {
			return false;
		}
		found.click();
		return true;
	});
}

/**
 * いま生きているコックピットの面（`data-assistant="Claude"` かつ `#homeToggle` を持つフレーム）。
 *
 * 板やタスクの webview を掴まないための 2 条件。`frameElement()` で親を辿らないのは、
 * webview が入れ子の iframe で、親の特定が当てにならないため（T-329 と同じ理由）。
 */
async function cockpitFrames(page) {
	const found = [];
	for (const frame of page.frames()) {
		try {
			const info = await frame.evaluate(() => {
				if (!document.getElementById('homeToggle')) {
					return null;
				}
				const tabs = document.getElementById('sessionTabs');
				return {
					assistant: document.body?.getAttribute('data-assistant') ?? '',
					// 列が**見えて**いるか（DOM に在るかではない・`cases/54-new-session-draft.mjs:75-85`）
					rail: Boolean(tabs) && !tabs.hidden && tabs.offsetParent !== null && tabs.offsetHeight > 0
				};
			});
			if (info && info.assistant === 'Claude') {
				found.push({ frame, rail: info.rail });
			}
		} catch {
			// フレームが入れ替わっている最中。次の周で拾う
		}
	}
	return found;
}

/**
 * コックピットの面が現れるまで待ち、Playwright の Frame 参照を返す（以後はこれを握って使い回す）。
 *
 * **2 枚以上あっても `ctx.expect` で落とさない。** 前のケースの残骸で前提が崩れただけで赤くなると、
 * 本丸の食い違いが読めなくなる。枚数は `console.log` で警告し、列を持つほうを選び直す。
 */
async function waitForCockpit(page, { skip = [], attempts = 16, wantRail = false } = {}) {
	for (let i = 0; i < attempts; i++) {
		const found = (await cockpitFrames(page)).filter((entry) => !skip.includes(entry.frame));
		const ready = found.length > 0 && (!wantRail || found.some((entry) => entry.rail) || i === attempts - 1);
		if (ready) {
			if (found.length > 1) {
				console.log(`  ！ コックピットの面が ${found.length} 枚見えています（列が出ているほうを選びます）`);
			}
			return found.find((entry) => entry.rail)?.frame ?? found[0].frame;
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/**
 * その面の Home の見えかた。
 *
 * `$eval` は `#home` が無ければ throw する。**面が作り直されたときも同じく throw する**ので、
 * 呼び出し側で catch して「サイドバーの面が作り直された」と別の理由で落とす。
 */
async function homeState(frame) {
	return frame.$eval('#home', (home) => {
		const log = document.getElementById('log');
		const toggle = document.getElementById('homeToggle');
		return {
			open: !home.hidden,
			// Home と会話は入れ替わりで出る（`media/cockpit.js:1001-1004`）
			chatHidden: Boolean(log) && log.hidden,
			marked: Boolean(toggle) && toggle.classList.contains('open')
		};
	});
}

/** 失敗の文言に埋める実測値 */
function describe(state) {
	if (!state) {
		return '読めず';
	}
	return `Home ${state.open ? '開' : '閉'} / 会話 ${state.chatHidden ? '隠' : '見'} / ≡ ${
		state.marked ? 'open あり' : 'open なし'
	}`;
}

/**
 * ≡ を押して、その面の Home を `want` の状態にする。最後に読んだ状態を返す。
 *
 * **押すのは `frame.evaluate` から。** `#homeToggle` は `.home-bar[hidden] { display: none }` の
 * 中に住むので、`ElementHandle.click()` だと「見えるまで待つ」で 30 秒溶ける。
 */
async function setHome(page, frame, want) {
	let state = await homeState(frame);
	for (let i = 0; i < 3 && state.open !== want; i++) {
		await frame.evaluate(() => document.getElementById('homeToggle')?.click());
		await page.waitForTimeout(700);
		state = await homeState(frame);
	}
	return state;
}

/** いま開いているコックピットのタブの見出し（失敗の文言に埋める） */
async function cockpitTabTitles(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.tabs-container .tab')]
			.map((el) => el.innerText ?? '')
			.filter((text) => text.includes('コックピット') || text.includes('Cockpit'))
			.join(' | ')
	);
}

/**
 * コックピットのタブを ✕ で閉じる。閉じた枚数を返す。
 *
 * キーボードの和音（⌘K W）は待ち状態が残り、`closeAllEditors` は webview のタブに効かない
 * （`cases/42-editor-tabs.mjs:44-56`）。**✕ を実際に押す**のがいちばん確実。
 */
async function closeCockpitTabs(page) {
	let closed = 0;
	for (let i = 0; i < 4; i++) {
		let hit = false;
		for (const tab of await page.$$('.tabs-container .tab')) {
			const text = await tab.evaluate((el) => el.innerText ?? '').catch(() => '');
			if (!text.includes('コックピット') && !text.includes('Cockpit')) {
				continue;
			}
			const close = await tab.$('.codicon-close, .tab-close');
			if (!close) {
				continue;
			}
			await close.click();
			hit = true;
			closed++;
			break;
		}
		if (!hit) {
			break;
		}
		await page.waitForTimeout(600);
	}
	return closed;
}

/** 焦点を webview の外へ戻す。`.part.activitybar` の中心はアイコンに当たるのでステータスバーを押す */
async function returnFocus(page) {
	await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
	await page.waitForTimeout(400);
}

export default {
	name: 'コックピットをタブで開き直しても、サイドバーの Home は閉じない',
	adversarial: true,
	async run(page, ctx) {
		let sidebarFrame;
		try {
			ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');

			// **先に下書きを 2 本作る（必須）。** 列が 1 本だと `#sessionTabs` は hidden で
			// （`media/cockpit.js:1305-1312`）、≡ が列へ移らないまま押しどころが無くなる
			ctx.expect(await pressNewSession(page), 'コックピットのタイトルに「新しいセッション」が無い');
			await page.waitForTimeout(800);
			ctx.expect(await pressNewSession(page), '2 回目の「新しいセッション」を押せない');
			await page.waitForTimeout(800);

			sidebarFrame = await waitForCockpit(page, { wantRail: true });
			ctx.expect(
				sidebarFrame !== undefined,
				'サイドバーのコックピット（data-assistant="Claude" と #homeToggle を持つ面）が見つからない'
			);

			// ① サイドバーで ≡ を開く
			const sidebarOpened = await setHome(page, sidebarFrame, true);
			ctx.expect(
				sidebarOpened.open,
				`サイドバーで ≡ を押しても Home が開かない: ${describe(sidebarOpened)}`
			);

			// ② タブを開く（1 回目・ここは通る想定）
			await runCommand(page, labels('command.openCockpitTab')[0]);
			await page.waitForTimeout(2000);
			const tabFrame = await waitForCockpit(page, { skip: [sidebarFrame] });
			ctx.expect(
				tabFrame !== undefined,
				`1 回目のタブ開きで、タブ側のコックピットの面が現れない（タブ: ${
					(await cockpitTabTitles(page)) || '（なし）'
				}）`
			);
			let afterFirst;
			try {
				afterFirst = await homeState(sidebarFrame);
			} catch (error) {
				ctx.expect(
					false,
					`1 回目のタブ開きでサイドバーの面が作り直された（#home が読めない）: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
			ctx.expect(
				afterFirst.open,
				`前提が崩れた: タブを開いただけでサイドバーの Home が閉じた（${describe(afterFirst)}）`
			);

			// ③ タブ側で ≡ を閉じる。**既に閉じていたら 1 度開いてから閉じる** —
			//    `homeOpened` は押したときにしか飛ばないので（`media/cockpit.js:1009`）、
			//    押さずに素通りすると provider の記憶が変わらず、2 回目の開き直しで
			//    何も配られない（＝食い違いを一度も踏まないまま緑になる）
			const tabStart = await homeState(tabFrame).catch(() => undefined);
			ctx.expect(tabStart !== undefined, 'タブ側の Home（#home）が読めない');
			if (!tabStart.open) {
				const reopened = await setHome(page, tabFrame, true);
				ctx.expect(reopened.open, `タブ側で ≡ を押しても Home が開かない: ${describe(reopened)}`);
			}
			const tabClosed = await setHome(page, tabFrame, false);
			ctx.expect(!tabClosed.open, `タブ側で ≡ を押しても Home が閉じない: ${describe(tabClosed)}`);

			// ④ タブを ✕ で閉じる。**閉じ切れたことまで確かめる** —
			//    1 枚でも残っていると `openInEditor` は `panel.reveal` で済ませ
			//    （`webview/WebviewViewHost.ts:56-59`）、2 回目の `ready` が飛ばない。
			//    食い違いを一度も踏まないまま緑になる道なので、押した回数だけでは足りない
			const closed = await closeCockpitTabs(page);
			const leftover = await cockpitTabTitles(page);
			ctx.expect(
				closed >= 1 && leftover === '',
				`コックピットのタブを ✕ で閉じ切れない（押した回数: ${closed} / 残っているタブ: ${
					leftover || '（なし）'
				}）。残ったまま開き直すと reveal だけで ready が飛ばず、食い違いを踏まずに緑になる`
			);
			await returnFocus(page);

			// ⑤ 2 回目のタブ開き。ここで 2 回目の `ready` が走る
			await runCommand(page, labels('command.openCockpitTab')[0]);
			await page.waitForTimeout(1200);
			// **列が見えるまで待つ**のが、配りが届いた証拠になる。`ready` の返しは
			// `sessions` → …（略）… → `home` の順で、`home` が最後
			// （`cockpit/CockpitViewProvider.ts:291-323` / `sessions` は :299）。
			// 列が出た＝`sessions` が届いた なので、
			// `home` はもう投げられている。固定の待ちだけだと「まだ届いていないから開いたまま」を
			// 緑と読んでしまう
			const tabFrameAgain = await waitForCockpit(page, { skip: [sidebarFrame], wantRail: true });
			ctx.expect(
				tabFrameAgain !== undefined,
				`2 回目のタブ開きで、タブ側のコックピットの面が現れない（タブ: ${
					(await cockpitTabTitles(page)) || '（なし）'
				}）`
			);
			// 最後の `home` が当たるまでの一拍
			await page.waitForTimeout(1200);

			let sidebarNow;
			try {
				sidebarNow = await homeState(sidebarFrame);
			} catch (error) {
				ctx.expect(
					false,
					`2 回目のタブ開きでサイドバーの面が作り直された（#home が読めない）: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
			const tabNow = await homeState(tabFrameAgain).catch(() => undefined);

			// **前提の確認**: 開き直したタブ側が「Home 閉」で戻っていること。
			// ここが「開」なら、③ で押した `homeOpened: false` が provider に入っておらず、
			// 2 回目の配りは `open: true` になる —— サイドバーは元から開いているので何も動かず、
			// **食い違いを一度も踏まないまま緑になる**。本丸の前に、別の理由で落とす
			ctx.expect(
				tabNow !== undefined && !tabNow.open,
				`前提が作れなかった: 開き直したタブ側に「Home 閉」が戻っていない（タブ側: ${describe(tabNow)}）。` +
					' provider が閉じた状態を覚えていないので、この試験は食い違いを踏めない'
			);

			// **本丸**: 触っていないサイドバーの Home が、タブの開き直しで閉じていないこと
			ctx.expect(
				sidebarNow.open,
				`タブを開き直しただけで、触っていないサイドバーの Home が閉じた —— ` +
					`サイドバー: ${describe(sidebarNow)} / タブ側: ${describe(tabNow)}。` +
					' Home の開閉が provider に 1 個しか無く、2 回目の ready が `open: false` を' +
					' view と panel の両方へ配っている（WebviewViewHost.postMessage）'
			);
		} finally {
			try {
				// 開いたタブは閉じる（次のケースが 2 枚目の面を掴まないように）
				await closeCockpitTabs(page);
				await returnFocus(page);

				// **Home を開いたまま終えない** — 次のケースの ≡ が「閉じる」動作になる
				// （`cases/54-new-session-draft.mjs:129-131` が実測している）
				if (sidebarFrame) {
					const left = await setHome(page, sidebarFrame, false).catch(() => undefined);
					if (!left || left.open) {
						console.log(`  ！ 後始末: サイドバーの Home を閉じられませんでした（${describe(left)}）`);
					}

					// 置いた下書きを片付ける。**× を押してよいのは下書きだけ** —
					// 走っているセッションの × は `{ modal: true }` の確認を出し、束が丸ごと死ぬ。
					// 列は 1 本になると畳まれて `.session-tab` ごと消えるので、
					// **最後の 1 本は構造上閉じられない**（ここで自然に打ち止めになる）
					for (let i = 0; i < 4; i++) {
						const hit = await sidebarFrame
							.evaluate(() => {
								const close = [...document.querySelectorAll('.session-tab-close')].find((el) =>
									(el.getAttribute('title') ?? '').includes('下書き')
								);
								if (!close) {
									return false;
								}
								close.click();
								return true;
							})
							.catch(() => false);
						if (!hit) {
							break;
						}
						await page.waitForTimeout(500);
					}
				}
				await returnFocus(page);
			} catch (error) {
				// 後始末の失敗で本来の失敗理由を消さない（ここで `ctx.expect` を投げない）
				console.log(`  ！ 後始末に失敗: ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
};
