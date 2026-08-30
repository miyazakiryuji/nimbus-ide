/**
 * Home の確認項目の自動化ぶん（T-332）。
 *
 * **≡ は廃止した**（T-345）。開くのは面のタイトル（`nimbus.openHome`）、
 * 戻るのは列の頭に出る「← 会話へ戻る」。開閉の観点はそのまま、押す場所だけが変わっている。
 *
 * 観点の全体は nimbus/docs/testing/home-checklist.md。ここで押すのは:
 * ① 開閉 — タイトルから Home が開き、← で会話へ戻る・← は開いているときだけ出る・
 *          開いた状態がエディタタブの面にも引き継がれる
 * ② 束 — 束 1 つならタブ列は出ない / 空の束も「セッションはまだありません」で出る
 * ③ 行 — 番号と状態の言葉が全行に入る・下書きに「移す」を出さない
 * ④ 前面の印（active）は多くても 1 つ
 * ⑧ キーボード — Home の行を Enter で開くと会話へ戻る
 *
 * セッションは要らない（下書き 2 本と空の束で全部確かめられる・課金なし）。
 */

/** 面のタイトルのボタンを、名前の一部で押す */
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
/** ≡ を廃止した分の入口（T-345）。Home を開くのはここ */
const pressOpenHome = (page) => pressTitleAction(page, '一覧（Home）');

/** コックピットのフレームを全部掴む（サイドバー・エディタタブ） */
async function cockpitFrames(page) {
	const frames = [];
	for (const frame of page.frames()) {
		try {
			if (await frame.$('#sessionTabs')) {
				frames.push(frame);
			}
		} catch {
			// 入れ替わり中のフレームは飛ばす
		}
	}
	return frames;
}

async function cockpitFrame(page, { attempts = 16 } = {}) {
	for (let i = 0; i < attempts; i++) {
		const frames = await cockpitFrames(page);
		if (frames.length > 0) {
			return frames[0];
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

/** Home の開閉と見え方を 1 枚で読む */
async function readHomeState(frame) {
	return frame.evaluate(() => ({
		panelShown: !document.getElementById('home').hidden,
		logShown: !document.getElementById('log').hidden,
		// ← は Home を開いているときだけ出る（T-345）
		backShown: !document.getElementById('homeBack').hidden,
		groupTabsShown: !document.getElementById('groupTabs').hidden
	}));
}

/** Home の行（番号・状態・active・「移す」の有無） */
async function readRows(frame) {
	return frame.$$eval('.home-session', (nodes) =>
		nodes.map((node) => ({
			number: node.querySelector('.session-tab-number')?.textContent ?? '',
			state: node.querySelector('.home-session-state')?.textContent ?? '',
			active: node.classList.contains('active'),
			hasMove: !!node.querySelector('[title="別のタブへ移す"]')
		}))
	);
}

/** メインの InputBox に打って Enter。開かなければ打たない（誤爆防止） */
async function typeIntoInputBox(page, text) {
	let visible = false;
	for (let i = 0; i < 12 && !visible; i++) {
		await page.waitForTimeout(500);
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
	name: 'Home の開閉・束・行・キーボードが確認項目どおり（T-332）',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);

		// 前提: 下書き 2 本で ≡ の行を出す（1 本だけだと行ごと出ない仕様）
		ctx.expect(await pressNewSession(page), '「新しいセッション」が押せない');
		await page.waitForTimeout(800);
		ctx.expect(await pressNewSession(page), '2 回目の「新しいセッション」が押せない');
		await page.waitForTimeout(1200);
		const side = await cockpitFrame(page);
		ctx.expect(side !== undefined, 'コックピットのフレームが見つからない');

		// ② 束が 1 つ（既定「作業」だけ）のうちは、タブ列は出ない（後方互換）
		const before = await readHomeState(side);
		ctx.expect(!before.groupTabsShown, '束が 1 つしか無いのにタブ列が出ている（後方互換が壊れた疑い）');
		ctx.expect(!before.panelShown && before.logShown, '開く前から Home が出ている');
		ctx.expect(
			!before.backShown,
			'会話を見ているのに「← 会話へ戻る」が出ている（押しても何も起きないボタンを置かない）'
		);

		// ① 開く: タイトルの入口（T-345）で Home が出て会話が隠れ、← が現れる
		ctx.expect(await pressOpenHome(page), 'タイトルの「一覧（Home）」が押せない');
		await page.waitForTimeout(900);
		const opened = await readHomeState(side);
		ctx.expect(opened.panelShown && !opened.logShown, 'タイトルから Home と会話が入れ替わらない');
		ctx.expect(opened.backShown, '一覧を開いたのに「← 会話へ戻る」が出ない');

		// ③④ 行: 番号と状態の言葉が全行に入る・下書きに「移す」は無い・active は多くても 1 つ
		const rows = await readRows(side);
		ctx.expect(rows.length >= 2, `下書き 2 本を作ったのに Home の行が ${rows.length} 行しか無い`);
		ctx.expect(
			rows.every((row) => row.number.trim() !== '' && row.state.trim() !== ''),
			`番号か状態の言葉が欠けた行がある: ${JSON.stringify(rows)}`
		);
		ctx.expect(
			rows.every((row) => !row.hasMove),
			'下書きの行に「移す」が出ている（下書き→本物で所属が迷子になる）'
		);
		ctx.expect(
			rows.filter((row) => row.active).length <= 1,
			`前面の印が ${rows.filter((row) => row.active).length} 行に付いている（多くても 1 つ）`
		);

		// ② 空の束: ＋ 新しいタブ → 名前 → 「(0)」と空の文言で出る
		await (await side.$('.home-new-group')).click();
		ctx.expect(await typeIntoInputBox(page, '点検用'), 'タブ名の入力欄が開かない');
		await page.waitForTimeout(1000);
		const groups = await side.$$eval('.home-group', (nodes) =>
			nodes.map((node) => ({
				header: (node.querySelector('.home-group-header')?.textContent ?? '').trim(),
				empty: (node.textContent ?? '').includes('セッションはまだありません')
			}))
		);
		const made = groups.find((group) => group.header.startsWith('点検用'));
		ctx.expect(made !== undefined, `作った束が Home に出ない: ${JSON.stringify(groups)}`);
		ctx.expect(
			made.header.includes('(0)') && made.empty,
			`空の束の出方が違う（(0) と「セッションはまだありません」が要る）: ${JSON.stringify(made)}`
		);
		await ctx.shot('59-home-checklist');

		// ⑧ キーボード: 行に焦点 → Enter で会話へ戻る
		await side.locator('.home-session').first().focus();
		await page.keyboard.press('Enter');
		await page.waitForTimeout(800);
		const afterEnter = await readHomeState(side);
		ctx.expect(
			!afterEnter.panelShown && afterEnter.logShown,
			'Home の行を Enter で開いても会話へ戻らない'
		);

		// ① 面をまたぐ引き継ぎ: 開いた状態でエディタタブの面を開くと、そちらも開いて出る。
		// **引き継がれるのは「新しく開いた面」**（既存の面は自分の状態を保つ — 画面分割 T-315 の設計）。
		// フル実行では前のケースのタブが残っていて再表示になり、ここが偽って落ちた。
		// 42 と同じ方法（タブの ✕ を実際に押す）で先に片付けてから開く
		for (let i = 0; i < 6; i++) {
			const closers = await page.$$('.tabs-container .tab .codicon-close, .tabs-container .tab .tab-close');
			if (closers.length === 0) {
				break;
			}
			await closers[0].click();
			await page.waitForTimeout(500);
		}
		ctx.expect(await pressOpenHome(page), '2 回目の「一覧（Home）」が押せない');
		await page.waitForTimeout(900);
		// **新しく開いた面だけ**を掴むため、コマンドの前後でフレーム集合を差分する。
		// 「#sessionTabs を持つ side 以外」だと、ヘルプ（ゆあ）の webview（同じ実装＝同じ DOM）や
		// 前のケースが残した面を掴んでしまう — フル実行でだけそれを読んで偽って落ちた
		const framesBefore = await cockpitFrames(page);
		await page.keyboard.press('F1');
		await page.waitForTimeout(600);
		await page.keyboard.type('コックピットをタブで開く', { delay: 15 });
		await page.waitForTimeout(800);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2000);
		let tabFrame;
		for (let i = 0; i < 10 && !tabFrame; i++) {
			const frames = await cockpitFrames(page);
			tabFrame = frames.find((frame) => !framesBefore.includes(frame));
			if (!tabFrame) {
				await page.waitForTimeout(500);
			}
		}
		ctx.expect(tabFrame !== undefined, 'エディタタブの面が開かない');
		const carried = await readHomeState(tabFrame);
		ctx.expect(carried.panelShown, 'サイドバーで開いた Home が、開き直した面に引き継がれていない');

		// ② 束が 2 つになったので、広い面のタブ列が出て、選ばれている chip はちょうど 1 つ
		ctx.expect(carried.groupTabsShown, '束が 2 つあるのに広い面のタブ列が出ない');
		const selected = await tabFrame.$$eval('.group-tab[role="tab"]', (nodes) =>
			nodes.filter((node) => node.getAttribute('aria-selected') === 'true').length
		);
		ctx.expect(selected === 1, `選ばれている束の chip が ${selected} 個ある（ちょうど 1 つ）`);
		await ctx.shot('59-home-wide');

		// 後片付け: 作った束を閉じる（中身が無いので何も戻らない）→ Home も閉じる
		const closeButton = await side.$('.home-group-header [title^="タブを閉じる"]');
		if (closeButton) {
			await closeButton.click();
			await page.waitForTimeout(800);
		}
		const leftover = await side.$$eval('.home-group-header', (nodes) =>
			nodes.map((node) => (node.textContent ?? '').trim()).filter((text) => text.startsWith('点検用'))
		);
		ctx.expect(leftover.length === 0, '後片付けで束を閉じられなかった');
		// 会話へ戻して次のケースへ渡す（開いたままだと、次が Home を会話と読み違える）
		const back = await side.$('#homeBack');
		if (back) {
			await back.click();
			await page.waitForTimeout(400);
		}
	}
};
