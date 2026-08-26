/**
 * タブ（セッションの束）の作成・改名・削除（T-314）。
 *
 * 利用者とすり合わせた形 — サイドバーの Home（≡）にタブごとの束が出て、
 * タブは自由に作れて改名できる。名前の入力は**拡張側の InputBox** なので、
 * webview の外（メインの quick input）へ打ち込む。
 *
 * **存在確認で止めない**（T-244）: ＋ 新しいタブ → 名前を打つ → 束が現れる →
 * 鉛筆で改名 → 見出しが変わる → × → 消える、まで実際に押す。
 * セッションは要らない（空のタブも Home に出す仕様なので、束だけで確かめられる）。
 */

/** 面のタイトルの「新しいセッション」を押す（下書きを増やして ≡ を出すため） */
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

/** コックピットのフレームを掴む */
async function cockpitFrame(page, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#homeToggle')) {
					return frame;
				}
			} catch {
				// 入れ替わり中のフレームは飛ばす
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/** Home の束見出しを読む */
async function readGroupHeaders(frame) {
	return frame.$$eval('.home-group-header', (nodes) =>
		nodes.map((node) => (node.textContent ?? '').trim())
	);
}

/** メインの InputBox に打って Enter。開くまで待ち、開かなければ**打たない**（誤爆防止） */
async function typeIntoInputBox(page, text) {
	let visible = false;
	for (let i = 0; i < 12 && !visible; i++) {
		await page.waitForTimeout(500);
		// style 文字列ではなく実体（描画されているか）で見る
		visible = await page.evaluate(() => {
			const widget = document.querySelector('.quick-input-widget');
			return !!widget && widget.offsetParent !== null;
		});
	}
	if (!visible) {
		return false;
	}
	await page.keyboard.type(text, { delay: 20 });
	await page.waitForTimeout(300);
	await page.keyboard.press('Enter');
	return true;
}

export default {
	name: 'タブ（束）を作って、名前を変えて、閉じられる',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);

		// ≡ を出すために下書きを 2 つ（1 本では畳む行が出ない）
		ctx.expect(await pressNewSession(page), '「新しいセッション」が押せない');
		await page.waitForTimeout(700);
		await pressNewSession(page);
		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの ≡ が見つからない');

		// Home を開く
		let barShown = false;
		for (let i = 0; i < 12 && !barShown; i++) {
			await page.waitForTimeout(500);
			barShown = await frame.$eval('#homeBar', (el) => !el.hidden).catch(() => false);
		}
		ctx.expect(barShown, '≡ の行が出ない');
		// ≡ はトグルなので、押す前に**開いているか**を見る（前のケースが開いたまま
		// 終えていると、押した結果が「閉じる」になり、隠れた古い面を読むことになる）
		const homeHidden = await frame.$eval('#home', (el) => el.hidden).catch(() => true);
		if (homeHidden) {
			await frame.$eval('#homeToggle', (el) => el.click());
		}
		await page.waitForTimeout(600);
		ctx.expect(
			await frame.$eval('#home', (el) => !el.hidden).catch(() => false),
			'Home が開かない'
		);

		// 1. 作る: ＋ 新しいタブ → InputBox に名前
		await frame.$eval('.home-new-group', (el) => el.click());
		ctx.expect(await typeIntoInputBox(page, 'ログイン改修'), 'タブ名の入力欄が開かない');
		let headers = [];
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(500);
			headers = await readGroupHeaders(frame);
			if (headers.some((text) => text.includes('ログイン改修'))) {
				break;
			}
		}
		ctx.expect(
			headers.some((text) => text.includes('ログイン改修 (0)')),
			`作ったタブが Home に出ない: ${JSON.stringify(headers)}`
		);

		// 2. 改名: 鉛筆 → InputBox を書き換え
		await frame.$eval('.home-group:nth-of-type(2) .icon-button', (el) => el.click());
		await page.waitForTimeout(800);
		// 既定で今の名前が入っているので、全選択してから打ち直す
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
		ctx.expect(await typeIntoInputBox(page, 'UI 直し'), '改名の入力欄が開かない');
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(500);
			headers = await readGroupHeaders(frame);
			if (headers.some((text) => text.includes('UI 直し'))) {
				break;
			}
		}
		ctx.expect(
			headers.some((text) => text.includes('UI 直し (0)')),
			`改名が Home に反映されない: ${JSON.stringify(headers)}`
		);

		// 3. 閉じる: × → 束が消える（既定タブ「作業」は残る）
		await frame.$$eval('.home-group:nth-of-type(2) .icon-button', (els) => {
			const close = els[els.length - 1];
			if (close) {
				close.click();
			}
		});
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(500);
			headers = await readGroupHeaders(frame);
			if (!headers.some((text) => text.includes('UI 直し'))) {
				break;
			}
		}
		ctx.expect(
			!headers.some((text) => text.includes('UI 直し')) && headers.some((text) => text.includes('作業')),
			`タブを閉じても消えない・または既定タブまで消えた: ${JSON.stringify(headers)}`
		);

		await ctx.shot('session-groups');
		// **Home は閉じて終える。** ケースはアプリを共有しているので、開きっぱなしは
		// 次のケースの前提を壊す（54 に書いた教訓を自分が破っていて、59（T-332）の
		// 「開く前から Home が出ている」で顕在化した）
		await frame.$eval('#homeToggle', (el) => el.click());
		await page.waitForTimeout(400);
	}
};
