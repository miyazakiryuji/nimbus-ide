/**
 * セッションを横に並べて見る（T-320）。
 *
 * 面はすべて「アクティブの鏡」だったので、2 面開いても同じものが映っていた。
 * ここで見るのは ① 並べた面が**別々の会話**を映す ② 束縛面からの入力が
 * **その面のセッションへ**届く（前面は動かない）。
 *
 * 2 本の実セッションが要るので `--with-claude` のときだけ。
 */
import { webviewText } from '../helpers.mjs';

/** 面のタイトルのボタンを名前で押す */
async function pressTitleAction(page, needle) {
	return page.evaluate((name) => {
		const found = [
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		].find((el) =>
			`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes(name)
		);
		if (!found) {
			return false;
		}
		found.click();
		return true;
	}, needle);
}

/** 会話に needle を含むフレームへ、入力して送る */
async function sendInFrameContaining(page, needle, text) {
	for (const frame of page.frames()) {
		const body = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
		if (!body.includes(needle)) {
			continue;
		}
		const input = await frame.$('#input');
		if (!input) {
			continue;
		}
		await input.click();
		await input.type(text, { delay: 10 });
		await frame.press('#input', 'Enter');
		return true;
	}
	return false;
}

/** needle を含むフレームの本文 */
async function frameTextContaining(page, needle) {
	for (const frame of page.frames()) {
		const body = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
		if (body.includes(needle)) {
			return body;
		}
	}
	return undefined;
}

export default {
	name: '並べた面が別々の会話を映し、入力はその面のセッションへ届く（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 2 本の実セッションが要る（課金）
		}
		// 1 本目は起動時のスモーク（NIMBUS_GUI_OK）。2 本目を + から作る
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);
		ctx.expect(await pressTitleAction(page, '新しいセッション'), '「新しいセッション」が押せない');
		await page.waitForTimeout(1500);
		ctx.expect(
			await sendInFrameContaining(page, 'に頼む', 'Reply with exactly: NIMBUS_TAB_TWO'),
			'2 本目の入力欄が見つからない'
		);
		ctx.expect(
			Boolean(await webviewText(page, ['NIMBUS_TAB_TWO'], { attempts: 40 })),
			'2 本目のセッションが動き出さない'
		);

		// 1 本目（NIMBUS_GUI_OK のほう）を横に並べる。
		// 入口は view/title の `...` にあるが、あふれメニューは環境で崩れやすいので
		// ここではコマンドパレットから呼ぶ（同じコマンド）
		await page.keyboard.press('F1');
		await page.waitForTimeout(600);
		await page.keyboard.type('セッションを横に並べて見る', { delay: 15 });
		await page.waitForTimeout(1000);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1200);
		// 候補（2 本）の先頭 = 1 本目
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2500);

		// ① 別々の会話が同時に映っている
		let both = false;
		for (let i = 0; i < 16 && !both; i++) {
			await page.waitForTimeout(500);
			const one = await frameTextContaining(page, 'NIMBUS_GUI_OK');
			const two = await frameTextContaining(page, 'NIMBUS_TAB_TWO');
			both = Boolean(one) && Boolean(two) && !one.includes('NIMBUS_TAB_TWO');
		}
		ctx.expect(both, '並べた面が別々の会話を映していない（同じものが 2 枚映っている疑い）');
		await ctx.shot('session-beside');

		// ② 束縛面からの入力は、その面のセッションへ
		ctx.expect(
			await sendInFrameContaining(page, 'NIMBUS_GUI_OK', 'Reply with exactly: BOUND_OK'),
			'束縛面の入力欄が見つからない'
		);
		let landed = false;
		for (let i = 0; i < 45 && !landed; i++) {
			await page.waitForTimeout(1000);
			const bound = await frameTextContaining(page, 'BOUND_OK');
			landed = Boolean(bound) && bound.includes('NIMBUS_GUI_OK');
		}
		ctx.expect(landed, '束縛面から送った返事が、その面に返ってこない');
		// 前面（2 本目）には混ざらない
		const active = await frameTextContaining(page, 'NIMBUS_TAB_TWO');
		ctx.expect(
			Boolean(active) && !active.includes('BOUND_OK'),
			'束縛面へ送ったはずの往復が、前面の会話に混ざっている'
		);
		await ctx.shot('session-beside-input');
	}
};
