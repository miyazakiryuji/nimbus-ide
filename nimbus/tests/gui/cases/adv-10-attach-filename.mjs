/**
 * 敵対的試験（T-345）— 敵意のある入力: 入力欄に画像を落としたら、1 枚は 1 枚として溜まる。
 *
 * **疑っている壊れかた** — `drop` のハンドラが `#input` と `document.body` の**両方**に
 * 同じ形で登録されていて、中では `preventDefault()` だけを呼び `stopPropagation()` を呼んでいない
 * （`extensions/nimbus/media/cockpit.js:891-902`）。`#input` に落ちたイベントは body まで上がるので
 * `addFile`（同 `708-720`）が 2 回走り、`pending`（同 `685`）に同じ画像が 2 つ積まれる（同 `715`）。
 * **画像を入力欄へドラッグしただけの普通の利用者が毎回踏み、送信すればそのぶん課金する。**
 * 敵対的な入力を用意しなくても出る、この束でいちばん重い欠陥。
 *
 * **期待する振る舞い** — `#input` に 1 枚落としたら `.attachment` は 1 枚（`document.body` に
 * 落としても 1 枚）。名前は文字のまま出て、`#attachments` の中に `img` / `[onerror]` /
 * `[onload]` は生えない（`renderPending` は `textContent` で書いている＝今日は素通りする副次の関門）。
 *
 * ※**双方向制御文字（`\u202E`）を剥がす期待は assert にしない。** 剥がすのが正しいかは
 * どこにも決めていない。ここでは `console.log` で残すだけにして、板に起こして合意してから格上げする。
 *
 * 根拠: `extensions/nimbus/media/cockpit.js:685, 708-720, 891-902` /
 * `extensions/nimbus/media/cockpit.css:1146-1157`（`.attachment` に幅の上限が無い） /
 * `extensions/nimbus/src/cockpit/CockpitViewProvider.ts:203, 439, 468-469`（`#attach` は
 * `showOpenDialog` なので絶対に押さない / `data-assistant` / `#attachments` と `#input`） /
 * 既存ケース `cases/64-draft-not-eaten.mjs:13-27`（フレームの掴みかた） /
 * `cases/61-cockpit-selection.mjs:14-30`（webview の待ちかた）
 */
import { openNimbusSidebar } from '../helpers.mjs';

/** 落とす名前に混ぜる毒。双方向制御文字は**必ず `\u202E` の形で**書く（生の不可視文字は整形で消える） */
const EVIL = '<img src=x onerror="nimbusAdv10()">\u202E';

/**
 * 落とすファイル名を組み立てる。**255 字まで**。
 *
 * ドロップは `new File(...)` の合成だけで作るので、実ファイルは 1 つも作らない
 * （実ファイルでは 10 万字も `../` も作れない。ここは合成専用だと分かるように短く保つ）。
 */
function craft(mark) {
	const head = `${mark}-${EVIL}`;
	const pad = 'a'.repeat(Math.max(0, 255 - head.length - '.png'.length));
	return `${head}${pad}.png`;
}

/**
 * コックピット（Claude のほう）の webview フレーム。
 *
 * ヘルプの「ゆあ」も同じ `cockpit.js` で描かれる（`extension.ts:3641`）ので、
 * `#input` だけで掴むと**別の面に落として**判定が空振りする。畳まれて幅がゼロの面も外す。
 *
 * 掴めなかったときに「見つからない」だけでは直せないので、**最後に見た面の実測**
 * （`data-assistant` / 幅 / `#input` と `#attachments` の有無）を一緒に返す。
 */
async function cockpit(page, { attempts = 20 } = {}) {
	let seen = [];
	for (let i = 0; i < attempts; i++) {
		seen = [];
		for (const frame of page.frames()) {
			try {
				const look = await frame.evaluate(() => ({
					assistant: document.body?.getAttribute('data-assistant') ?? '',
					width: document.body?.clientWidth ?? -1,
					input: Boolean(document.getElementById('input')),
					bar: Boolean(document.getElementById('attachments'))
				}));
				if (look.assistant) {
					// コックピット系の面だけを控える（無関係なフレームまで並べると読めない）
					seen.push(
						`data-assistant=${JSON.stringify(look.assistant)} / 幅 ${look.width}px / ` +
							`#input=${look.input} / #attachments=${look.bar}`
					);
				}
				if (look.assistant === 'Claude' && look.width > 100 && look.input && look.bar) {
					return { frame, seen };
				}
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return { frame: undefined, seen };
}

/** 画像を 1 枚、`#input` か `document.body` へ落とす（ファイルシステムには一切触らない） */
async function drop(frame, where, fileName) {
	await frame.evaluate(
		({ target, name }) => {
			// 8 バイトの偽 PNG（署名だけ）。`addFile` は `file.type` しか見ないので中身は要らない
			const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
			const dataTransfer = new DataTransfer();
			dataTransfer.items.add(new File([bytes], name, { type: 'image/png' }));
			const el = target === 'input' ? document.getElementById('input') : document.body;
			el.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
		},
		{ target: where, name: fileName }
	);
}

/** いま出ている札のようす。**自分が落としたものは名前の印で選ぶ**（並び順や総数に頼らない） */
async function measure(frame, mark) {
	return frame.evaluate((needle) => {
		const bar = document.getElementById('attachments');
		const chips = [...document.querySelectorAll('#attachments .attachment')];
		const mine = chips.filter((chip) => (chip.textContent ?? '').includes(needle));
		return {
			mine: mine.length,
			all: chips.length,
			injected: bar ? bar.querySelectorAll('img, [onerror], [onload]').length : -1,
			html: bar ? (bar.innerHTML ?? '').slice(0, 240) : '',
			text: mine.length > 0 ? (mine[0].textContent ?? '').slice(0, 70) : '',
			widest: mine.reduce((max, chip) => Math.max(max, Math.round(chip.getBoundingClientRect().width)), 0),
			panel: document.body.clientWidth
		};
	}, mark);
}

/**
 * 札が出るのを待ってから数える。
 *
 * `addFile` は `FileReader` 経由なので**1 枚ずつ非同期に**積まれる。
 * 1 枚見えた時点で数えると、遅れて来る 2 枚目を数え落として**偽の緑**になる。
 * 見えてから、さらに待ってから数える。
 */
async function waitForChips(page, frame, mark, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		const seen = await measure(frame, mark);
		if (seen.mine > 0) {
			await page.waitForTimeout(1200);
			return measure(frame, mark);
		}
		await page.waitForTimeout(300);
	}
	return measure(frame, mark);
}

export default {
	name: '入力欄に画像を落としたら、1 枚は 1 枚として溜まる',
	adversarial: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const { frame, seen } = await cockpit(page);
		ctx.expect(
			frame !== undefined,
			'コックピット（data-assistant="Claude"・幅 > 100・#input と #attachments を持つ面）を掴めない: ' +
				`見えた面 ${seen.length} 枚 — ${seen.join(' ／ ') || 'data-assistant を持つ面が 1 つも無い'}`
		);

		const bodyMark = 'adv10-body';
		const inputMark = 'adv10-input';

		try {
			// 1. まず `document.body` へ落とす。ここは登録が 1 つしかないので**対照**になる。
			//    同時に「ハーネス側でドロップを合成できたか」の関門にもなる
			await drop(frame, 'body', craft(bodyMark));
			const onBody = await waitForChips(page, frame, bodyMark);
			ctx.expect(
				onBody.mine > 0,
				'ハーネス側のドロップ合成に失敗（札が 1 枚も出ないので、この先は何も確かめられない）: ' +
					`body へ落として ${onBody.mine} 枚 / #attachments の札は全部で ${onBody.all} 枚 / ` +
					`innerHTML=${JSON.stringify(onBody.html)}`
			);

			// 2. 本命。`#input` へ落とす。ここで body まで上がって `addFile` が 2 回走る
			await drop(frame, 'input', craft(inputMark));
			const onInput = await waitForChips(page, frame, inputMark);
			await ctx.shot('adv-10-attach-filename');

			// 双方向制御文字を剥がすかは**決めていない**。assert にはせず、記録だけ残す
			console.log(
				`  ・落とした名前の見えかた（副次・判定しない）: 双方向制御文字 \\u202E は` +
					`${onInput.text.includes('\u202E') ? 'そのまま出ている' : '消えている'} / ` +
					`札の文字=${JSON.stringify(onInput.text)}`
			);

			// --- 本命の判定（1 本だけ） ---
			ctx.expect(
				onInput.mine === 1,
				'入力欄へ 1 枚落としただけで添付が二重に溜まった（drop が #input と body の両方で走っている）: ' +
					`#input へ 1 枚落として ${onInput.mine} 枚 / 対照（body へ 1 枚）は ${onBody.mine} 枚 / ` +
					`#attachments の札は全部で ${onInput.all} 枚 / 札の文字=${JSON.stringify(onInput.text)}`
			);

			// --- 副次 1: 名前が HTML として解釈されていない ---
			ctx.expect(
				onInput.injected === 0,
				`添付の名前が HTML として生えた（img / [onerror] / [onload] が ${onInput.injected} 個）: ` +
					`innerHTML=${JSON.stringify(onInput.html)}`
			);

			// --- 副次 2: 長い名前 1 つで面が横に伸びない ---
			ctx.expect(
				onInput.widest <= onInput.panel,
				`長い名前の札が面からはみ出した（.attachment に幅の上限が無い）: ` +
					`札の幅 ${onInput.widest}px / コックピットの幅 ${onInput.panel}px / ` +
					`名前は ${craft(inputMark).length} 字`
			);
		} finally {
			// `pending` は面ごとの JS 変数で `resetWorkbench` が戻さない（T-340）。
			// 残すと**後のケースが知らない画像を送る**ので、必ず 0 枚に戻す。
			// finally の中では ctx.expect を投げない（本来の失敗理由が消える）
			let left = -1;
			for (let i = 0; i < 12; i++) {
				try {
					left = await frame.evaluate(() => {
						const chip = document.querySelector('#attachments .attachment');
						if (chip) {
							/** @type {HTMLElement} */ (chip).click();
						}
						return document.querySelectorAll('#attachments .attachment').length;
					});
				} catch (error) {
					console.log(`  ！ 添付を外せませんでした: ${error?.message ?? error}`);
					break;
				}
				if (left === 0) {
					break;
				}
				await page.waitForTimeout(200);
			}
			if (left > 0) {
				console.log(`  ！ 添付が ${left} 枚残っています（次のケースが知らない画像を送るおそれ）`);
			} else if (left < 0) {
				console.log('  ！ 添付の枚数を数えられませんでした（面が入れ替わった可能性）');
			}
		}
	}
};
