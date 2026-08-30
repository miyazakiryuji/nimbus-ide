/**
 * タブ（セッションの束）の作成・改名・削除（T-314）。
 *
 * 利用者とすり合わせた形 — サイドバーの Home にタブごとの束が出て、
 * タブは自由に作れて改名できる。名前の入力は**拡張側の InputBox** なので、
 * webview の外（メインの quick input）へ打ち込む。
 *
 * **≡ は廃止された**（T-345 / `d02cd68fc1f`）。開くのは面のタイトルの `nimbus.openHome`、
 * 閉じるのは「← 会話へ戻る」。観点はそのままで、押す場所だけが変わっている。
 *
 * **存在確認で止めない**（T-244）: ＋ 新しいタブ → 名前を打つ → 束が現れる →
 * 鉛筆で改名 → 見出しが変わる → × → 消える、まで実際に押す。
 * セッションは要らない（空のタブも Home に出す仕様なので、束だけで確かめられる）。
 */

/** 面のタイトルのボタンを、名前の一部で押す（59-home-checklist.mjs:19-34 と同じ） */
async function pressTitleAction(page, label) {
	return page.evaluate((needle) => {
		const found = [
			...document.querySelectorAll(
				'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
			)
		].find((el) =>
			`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes(needle)
		);
		if (!found) {
			return false;
		}
		found.click();
		return true;
	}, label);
}

/** 下書きを増やして列を出すため */
const pressNewSession = (page) => pressTitleAction(page, '新しいセッション');
/** ≡ を廃止した分の入口（T-345 / `d02cd68fc1f`）。Home を開くのはここ */
const pressOpenHome = (page) => pressTitleAction(page, '一覧（Home）');

/** コックピットのフレームを掴む */
async function cockpitFrame(page, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#homeBack')) {
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

		// 列を出すために下書きを 2 つ（1 本では列が出ない）
		ctx.expect(await pressNewSession(page), '「新しいセッション」が押せない');
		await page.waitForTimeout(700);
		await pressNewSession(page);
		const frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの面が見つからない');

		// 列が**見えて**から進む（下書きが 2 本届いた合図。以前は ≡ の行で代用していた）
		let stripShown = false;
		for (let i = 0; i < 12 && !stripShown; i++) {
			await page.waitForTimeout(500);
			stripShown = await frame
				.$eval('#sessionTabs', (el) => !el.hidden && el.offsetParent !== null && el.offsetHeight > 0)
				.catch(() => false);
		}
		ctx.expect(stripShown, '「新しいセッション」を 2 回押したのに、タブ列が**見えて**いない');
		// 開く操作は面のタイトルへ移った（T-345）。押す前に**開いているか**を見るのは変えない
		// — 前のケースが開いたまま終えていると、隠れた古い面を読むことになる
		const homeHidden = await frame.$eval('#home', (el) => el.hidden).catch(() => true);
		if (homeHidden) {
			ctx.expect(await pressOpenHome(page), '面のタイトルの「一覧（Home）」を押せない');
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
		await frame.$eval('#homeBack', (el) => el.click());
		await page.waitForTimeout(400);
	}
};
