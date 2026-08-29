/**
 * コックピットの文字を範囲選択できることの確認（T-339）。
 *
 * **本物のマウスドラッグで測る。** `getSelection()` を JS から作ると必ず「選べる」になり、
 * 利用者が困っている経路（ヒットテスト・イベント・描き換え）を素通りしてしまう。
 * 実際この不具合は「選べない」ではなく、**選んだ端から中身が動く**という形をしていた
 * ── 道具の行を引くと click が続けて走って畳みが開き、追いかけの自動スクロールが
 * 足元で content を動かして、引いた範囲と違うところが選ばれていた。
 * どちらも CSS や見た目の確認では捕まらない。
 */
import { openNimbusSidebar } from '../helpers.mjs';

/** コックピットの webview フレームと、その画面上の原点を掴む */
async function cockpit(page, { attempts = 20 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#log')) {
					const box = (await (await frame.frameElement()).boundingBox()) ?? { x: 0, y: 0 };
					return { frame, origin: box };
				}
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/**
 * 選択を消してから、要素の中を左から右へ本物のドラッグ。選ばれた文字を返す。
 * `selectors` は優先順。**器（.welcome など）ではなく中の行を狙う** — 器の上端を掴むと
 * 余白の帯だけを横切って何も選べず、それを不具合と読み違える（実測でこれに嵌まった）
 */
async function dragAcross(page, { frame, origin }, selectors) {
	const box = await frame.evaluate((list) => {
		for (const sel of list) {
			const el = document.querySelector(sel);
			if (el && (el.textContent ?? '').trim()) {
				const r = el.getBoundingClientRect();
				if (r.width > 20 && r.height > 6) {
					return { x: r.x, y: r.y, w: r.width, h: r.height };
				}
			}
		}
		return null;
	}, selectors);
	if (!box) {
		return null;
	}
	// **残った選択の上で mousedown すると、ブラウザは「選択のドラッグ＆ドロップ」を始めて
	// 新しい選択が始まらない。** これを製品の不具合と読み違えかけた（実測）
	await frame.evaluate(() => window.getSelection()?.removeAllRanges());
	const y = box.y + Math.min(10, box.h / 2);
	await page.mouse.move(origin.x + box.x + 2, origin.y + y);
	await page.mouse.down();
	await page.mouse.move(origin.x + box.x + Math.max(50, box.w - 6), origin.y + y, { steps: 15 });
	await page.mouse.up();
	await page.waitForTimeout(300);
	return frame.evaluate(() => window.getSelection()?.toString() ?? '');
}

async function sendFromCockpit(page, text) {
	for (const frame of page.frames()) {
		const input = await frame.$('#input');
		if (!input) {
			continue;
		}
		await input.click();
		await input.type(text, { delay: 10 });
		await page.keyboard.press('Enter');
		return true;
	}
	return false;
}

export default {
	name: 'コックピットの文字をドラッグで範囲選択できる',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const view = await cockpit(page);
		ctx.expect(view !== undefined, 'コックピットの会話の列（#log）が見つからない');

		// 1. 会話の面の文字が引いて選べる。
		//    セッションが無いときは案内、走っているときは発言 — **どちらの状態でも選べること**を見る
		//    （--with-claude では起動時のスモークが 1 本走らせるので、案内はもう無い）
		const first = await dragAcross(page, view, [
			'.turn-body p', '.turn-body', '.welcome p', '.welcome li', '.welcome h2'
		]);
		ctx.expect(
			Boolean(first && first.trim()),
			`会話の面の文字を引いても何も選ばれない（.chat-list の user-select が効いていない）: ${JSON.stringify(first)}`
		);

		// 2. 会話の行は、左右の余白も含めて「文字の面」に見えること
		const shape = await view.frame.evaluate(() => {
			const list = document.querySelector('.chat-list');
			const probe = document.createElement('div');
			probe.className = 'turn';
			list.appendChild(probe);
			const style = getComputedStyle(probe);
			const out = { userSelect: style.userSelect, cursor: style.cursor };
			probe.remove();
			return out;
		});
		ctx.expect(
			shape.userSelect === 'text' && shape.cursor === 'text',
			`発言の行が文字の面になっていない: ${JSON.stringify(shape)}`
		);

		if (!ctx.withClaude) {
			return; // 会話の中身は実セッションが要る。指定が無ければここまで
		}

		// 3. **写したい筆頭は、道具の行のツール名とコマンド。**
		//    ここを引くと畳みが開いてしまい、選んだそばから中身が動いていた
		ctx.expect(
			await sendFromCockpit(page, 'Read the README.md in this folder and describe it in one line.'),
			'コックピットの入力欄が見つからない'
		);
		let summary = null;
		for (let i = 0; i < 60; i++) {
			await page.waitForTimeout(1500);
			await view.frame.evaluate(() => {
				const allow = [...document.querySelectorAll('.approval-actions button')]
					.find((el) => el.textContent === '許可');
				allow?.click();
			});
			summary = await view.frame.$('.collapsible-title');
			if (summary) {
				break;
			}
		}
		ctx.expect(summary !== null, '道具の行（折りたたみの見出し）が出てこない');

		// 失敗した道具の行は既定で開く（isError）ので、開閉は**前後の差**で見る。
		// 「開いていない」を絶対値で見ると、開いた状態から始まっただけで落ちる
		const isOpen = () => view.frame.evaluate(
			() => document.querySelector('.collapsible')?.classList.contains('open') ?? false
		);
		const openedBeforeDrag = await isOpen();
		const picked = await dragAcross(page, view, ['.collapsible-title']);
		ctx.expect(
			Boolean(picked && picked.trim()),
			`道具の行を引いても何も選ばれない: ${JSON.stringify(picked)}`
		);

		// 4. **ここが本丸。** 引いただけで畳みが動かないこと。動くと、選んだそばから
		//    中身が出たり消えたりして写せない（直し前はこれが 100% 起きていた）
		ctx.expect(await isOpen() === openedBeforeDrag, '文字を引いただけで折りたたみが開閉してしまう');

		// 5. それでも**押せば開く**（選べるようにした引き換えに、機能を落としていない）
		const before = await isOpen();
		await (await view.frame.$('.collapsible-summary')).click();
		await page.waitForTimeout(400);
		ctx.expect(await isOpen() !== before, '折りたたみの見出しを押しても開閉しない');
		await ctx.shot('cockpit-selection');
	}
};
