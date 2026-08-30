/**
 * 敵対的試験 adv-11（T-345）: 2,000 件の会話を戻しても、コックピットが破綻しない。
 *
 * **何を疑っているか** — `history` の描き直しは `log.textContent = ''` のあと、
 * **件数の上限も分割描画も無しに** 1 件ずつ描く（`extensions/nimbus/media/cockpit.js:1596-1608`）。
 * しかも 1 件ごとに `atBottom()`（`scrollHeight` を読む・同 `:146-148`）と
 * `stickToBottom()`（`scrollTop` を書く・同 `:173-177`）が挟まるので、
 * **2,000 回の強制レイアウト**が同期で走る。2,000 は保持の上限そのもの
 * （`extensions/nimbus/src/extension.ts:294` の `MAX_RETAINED_EVENTS`）で、
 * 面を開き直すたびの `snapshot()` 経路（`extensions/nimbus/src/cockpit/CockpitViewProvider.ts:294`）で
 * 実際に通る道。タブ切り替えで流れるのは控えの 500 件（同 `:297` / `extension.ts:3123-3128`）なので、
 * 2,000 件が一度に届くのは**開き直し**のほう。ここはそれを模している。
 *
 * **なぜ落ちうるか** — `parallel-load.md` が「2,000 件でも 0.1ms」と測ったのは
 * **core の畳み直し**であって、コックピットの DOM は一度も測られていない。
 * 加えて、切れ目の無い 1 語を守っているのは `.turn-body { overflow-wrap: anywhere }`
 * （`extensions/nimbus/media/cockpit.css:380-384`）**1 枚だけ**で、これが落ちると横に破れる。
 *
 * **期待する振る舞い** — 描き終わる。横スクロールは出ない。入力欄と送信ボタンは押せる場所に残る。
 * 最後まで送られて、会話の末尾が見えている。
 *
 * **測りかたの注意**
 * - 横の破綻は **`#log` の `scrollWidth`** で測る。`documentElement` は
 *   `.chat-list { overflow-x: hidden }`（同 `:307-311`）と `height: 100vh` の flex のせいで
 *   **壊れていても伸びない** ＝ その判定は緑のまま素通りする。
 * - **所要時間は判定にしない**（共有 Electron の混み具合で揺れる）。ms は `console.log` に残す。
 * - 巨大な 1 段落は 10 万字ではなく **2,000 字**。狙いは `overflow-wrap: anywhere` 1 枚の回帰よけで、
 *   それには 2,000 字で足りる（minify 済みの 1 行を貼られた、という現実にある形）。
 * - 流し込む形は**拡張が実際に送るのと同じ** `NimbusEvent`（`extensions/nimbus/src/events.ts:164-178`）。
 *   形を変えると、落ちても製品の不具合とは言えなくなる。
 *   `session` は付けない ＝ `resetToBlank`（`extension.ts:3595`）と同じ形なので、
 *   描き終わりに `setRunning(false)` まで戻る。
 */
import { openNimbusSidebar } from '../helpers.mjs';

/** 保持の上限そのもの（`extension.ts:294` の `MAX_RETAINED_EVENTS`） */
const TOTAL = 2000;
/** 自分が流したものだけを名前で見分ける印（束の残骸を巻き込まないため） */
const MARKER = 'adv-11';
/** 末尾に置く印。「最後まで送られている」をこれで見る */
const TAIL = `${MARKER} 末尾の応答`;
/** 切れ目の無い ASCII 2,000 字。base64 の 1 行を貼られた形 */
const LONG_TEXT = 'eyJhbGciOiJIUzI1NiJ9'.repeat(100);
/** 長い 1 段落を置く位置（5 で割って 4 余る ＝ assistant-text の枠） */
const LONG_AT = 999;

/**
 * コックピットの webview フレームを掴む。
 *
 * `#log` を持つだけでは足りない — 「ゆあに聞く」も同じ実装で、畳まれた面も生きたまま残る
 * （T-329 / T-340 の形）。`data-assistant`（`CockpitViewProvider.ts:439`）で面を選び、
 * `clientWidth > 0` と `offsetParent !== null` で「いま見えている」ことまで確かめる
 * （Home を開くと `log.hidden = true` になる・`cockpit.js:999-1010`）。
 * 掴めなかったときに何が見えていたかを言えるよう、見た面の実測値も返す。
 */
async function findCockpit(page, { attempts = 12 } = {}) {
	let seen = [];
	for (let i = 0; i < attempts; i++) {
		seen = [];
		for (const frame of page.frames()) {
			let info;
			try {
				info = await frame.evaluate(() => {
					const log = document.getElementById('log');
					if (!log) {
						return null;
					}
					return {
						assistant: document.body?.dataset?.assistant ?? '(なし)',
						width: log.clientWidth,
						attached: log.offsetParent !== null
					};
				});
			} catch {
				continue; // 破棄されたフレームは飛ばす
			}
			if (!info) {
				continue;
			}
			seen.push(info);
			if (info.assistant === 'Claude' && info.width > 0 && info.attached) {
				return { frame, seen };
			}
		}
		await page.waitForTimeout(500);
	}
	return { frame: undefined, seen };
}

/** 掴めなかったときに出す、見えていた面の一覧（実測値つき） */
function describe(seen) {
	if (seen.length === 0) {
		return '（#log を持つフレームが 1 つも無い）';
	}
	return seen
		.map((f) => `data-assistant=${f.assistant} / clientWidth=${f.width}px / 貼り付き=${f.attached}`)
		.join(' | ');
}

/**
 * 会話の列の寸法。**`#log` の innerText は丸ごと読まない**（2,000 件ぶんを毎回運ぶことになる）。
 * 末尾の 1 枚だけを名前で見分けられるところまで読む。
 */
async function measure(frame) {
	return frame.evaluate(() => {
		const log = document.getElementById('log');
		const send = document.getElementById('send');
		const input = document.getElementById('input');
		/** 中心が本当に押せるか（重なりまで見る）。見た目の矩形だけでは「押せる」と言えない */
		const reach = (el) => {
			if (!el) {
				return { w: 0, h: 0, inView: false, onTop: false };
			}
			const r = el.getBoundingClientRect();
			const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
			return {
				w: Math.round(r.width),
				h: Math.round(r.height),
				inView:
					r.width > 0 &&
					r.height > 0 &&
					r.top >= 0 &&
					r.left >= 0 &&
					r.bottom <= document.documentElement.clientHeight + 1 &&
					r.right <= document.documentElement.clientWidth + 1,
				onTop: Boolean(top) && (el === top || el.contains(top))
			};
		};
		const turns = log.querySelectorAll('.turn');
		const last = turns[turns.length - 1];
		return {
			turns: turns.length,
			scrollWidth: log.scrollWidth,
			clientWidth: log.clientWidth,
			scrollHeight: log.scrollHeight,
			clientHeight: log.clientHeight,
			scrollTop: Math.round(log.scrollTop),
			docScrollWidth: document.documentElement.scrollWidth,
			tail: (last?.textContent ?? '').slice(0, 60),
			send: reach(send),
			input: reach(input)
		};
	});
}

export default {
	name: '2,000 件の会話を戻しても、コックピットが破綻しない',
	adversarial: true,
	async run(page, ctx) {
		// 実セッションがあるときは触らない — 後始末の空 `history` が、本物の会話と帯を消してしまう
		if (ctx.withClaude) {
			console.log('  － adv-11: --with-claude では走らせません（後始末の空 history が本物の帯を殺すため）');
			return;
		}

		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const found = await findCockpit(page);
		ctx.expect(
			found.frame !== undefined,
			`見えているコックピット（data-assistant="Claude" の #log）を掴めない。見えた面: ${describe(found.seen)}`
		);
		const frame = found.frame;

		try {
			// 拡張が送るのと同じ形の `history` を、webview の中から自分に投げる。
			// 同じ listener（`cockpit.js:1528`）が拾うので、経路は製品のものと同じ
			const started = Date.now();
			const plan = await frame.evaluate(
				({ total, longAt, longText, marker, tail }) => {
					const sessionId = '00000000-0000-4000-8000-00000000ad11';
					const at = Date.now() - total * 10;
					const events = [
						{
							kind: 'session-init',
							sessionId,
							timestamp: at,
							claudeSessionId: 'adv-11-claude',
							claudeCodeVersion: '0.0.0-adv',
							model: 'adv-11-model',
							cwd: '/adv-11',
							permissionMode: 'default',
							apiKeySource: 'none',
							tools: [],
							mcpServers: [],
							plugins: [],
							skills: [],
							slashCommands: []
						}
					];
					// `tool-result` は先に出た `tool-use` の行を書き換えるだけで、新しい `.turn` を作らない。
					// 期待する枚数はそのぶんを引く
					let folded = 0;
					for (let i = 1; i < total; i++) {
						const timestamp = at + i * 10;
						switch (i % 5) {
							case 0:
								events.push({ kind: 'user-text', sessionId, timestamp, text: `${marker} 依頼 ${i}` });
								break;
							case 1:
								events.push({ kind: 'assistant-thinking', sessionId, timestamp, text: `${marker} 考え ${i}` });
								break;
							case 2:
								events.push({
									kind: 'tool-use',
									sessionId,
									timestamp,
									toolUseId: `${marker}-tool-${i}`,
									toolName: 'Read',
									input: { file_path: `/adv-11/file-${i}.ts` }
								});
								break;
							case 3:
								events.push({
									kind: 'tool-result',
									sessionId,
									timestamp,
									toolUseId: `${marker}-tool-${i - 1}`,
									isError: false,
									preview: `${marker} 結果 ${i}`
								});
								folded++;
								break;
							default:
								events.push({
									kind: 'assistant-text',
									sessionId,
									timestamp,
									text: i === total - 1 ? tail : i === longAt ? longText : `${marker} 応答 ${i}`
								});
								break;
						}
					}
					// `session` は付けない（`resetToBlank` と同じ形）
					window.postMessage({ type: 'history', events }, '*');
					return { sent: events.length, expected: events.length - folded };
				},
				{ total: TOTAL, longAt: LONG_AT, longText: LONG_TEXT, marker: MARKER, tail: TAIL }
			);

			// 描き切るまで待つ。**時間では落とさない** — 判定は「描き終わったか」だけ
			let shape = await measure(frame);
			for (let i = 0; i < 40 && shape.turns < plan.expected; i++) {
				await page.waitForTimeout(800);
				shape = await measure(frame);
			}
			const ms = Date.now() - started;
			console.log(
				`  · adv-11: ${plan.sent} 件を描くのに ${ms}ms（発言 ${shape.turns}/${plan.expected} 枚。判定には使いません）`
			);

			// **判定より先に 1 枚撮る。** 落ちたときの写真は run.mjs が catch で撮るが、
			// それは finally（空の `history`）が走ったあと ＝ **列を消したあとの画面**になる。
			// 破れた列を目で見られるのは、ここで撮っておいたぶんだけ
			await ctx.shot('adv-11-history-2000-turns');

			ctx.expect(
				shape.turns >= plan.expected,
				`2,000 件を流したのに描き切らない: 発言 ${shape.turns} 枚 / 期待 ${plan.expected} 枚（送った件数 ${plan.sent}・${ms}ms 待った）`
			);

			// 横の破れを測る**前提**が本当に置けたか。`LONG_AT` が畳まれる枠（tool-result）へ
			// ずれると 2,000 字が 1 度も列に入らず、次の判定が**素通りで緑になる**
			const longest = await frame.evaluate(() =>
				[...document.querySelectorAll('#log .turn-body p')].reduce(
					(max, p) => Math.max(max, (p.textContent ?? '').length),
					0
				)
			);
			ctx.expect(
				longest >= LONG_TEXT.length,
				`切れ目の無い 1 段落が列に入っていない: いちばん長い段落は ${longest} 字（置いたのは ${LONG_TEXT.length} 字・${LONG_AT} 番目）— 横の破れを測る前提が作れていない`
			);

			// 横に破れていないか。**#log で測る**（documentElement は壊れていても伸びない）
			ctx.expect(
				shape.scrollWidth <= shape.clientWidth + 2,
				`切れ目の無い 2,000 字で会話の列が横に破れた: #log の scrollWidth=${shape.scrollWidth}px / clientWidth=${shape.clientWidth}px（documentElement は ${shape.docScrollWidth}px）`
			);

			// 末尾まで描かれ、そこが見えている
			ctx.expect(
				shape.tail.includes(TAIL),
				`会話の末尾が最後の発言になっていない: 末尾の 1 枚は「${shape.tail || '（空）'}」（期待は「${TAIL}」で始まる 1 枚）`
			);
			ctx.expect(
				shape.scrollTop >= shape.scrollHeight - shape.clientHeight - 40,
				`描き終わりに末尾まで送られていない: scrollTop=${shape.scrollTop}px / 末尾は ${
					shape.scrollHeight - shape.clientHeight
				}px（scrollHeight=${shape.scrollHeight}px・clientHeight=${shape.clientHeight}px）`
			);

			// 入力欄と送信ボタンが、押せる場所に残っている
			ctx.expect(
				shape.input.inView && shape.input.onTop,
				`2,000 件を戻したら入力欄が押せる場所から外れた: ${shape.input.w}×${shape.input.h}px / 面の中=${shape.input.inView} / 最前面=${shape.input.onTop}`
			);
			ctx.expect(
				shape.send.inView && shape.send.onTop,
				`2,000 件を戻したら送信ボタンが押せる場所から外れた: ${shape.send.w}×${shape.send.h}px / 面の中=${shape.send.inView} / 最前面=${shape.send.onTop}`
			);
		} finally {
			// 流し込んだ会話を必ず戻す（`resetToBlank` と同じ空の history）。
			// **ここで ctx.expect を投げない** — 本来の失敗理由が消える
			try {
				await frame.evaluate(() => window.postMessage({ type: 'history', events: [] }, '*'));
				let left = -1;
				for (let i = 0; i < 10; i++) {
					await page.waitForTimeout(500);
					left = await frame.evaluate(() => document.querySelectorAll('#log .turn').length);
					if (left === 0) {
						break;
					}
				}
				if (left !== 0) {
					console.log(`  ！ 流し込んだ会話を戻し切れませんでした（発言が ${left} 枚残っています）`);
				}
			} catch (error) {
				console.log(`  ！ 流し込んだ会話を戻せませんでした: ${error?.message ?? error}`);
			}
			// 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）。
			// `.part.activitybar` の中心はアイコンに当たるので、ステータスバーを位置指定で押す
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(300);
		}
	}
};
