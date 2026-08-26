/**
 * Home（≡）の確認項目の自動化ぶん（T-332）。
 *
 * 観点の全体は nimbus/docs/testing/home-checklist.md。ここで押すのは:
 * ① 開閉 — ≡ で Home と会話が入れ替わる・ツールチップも入れ替わる・
 *          開いた状態がエディタタブの面にも引き継がれる
 * ② 束 — 束 1 つならタブ列は出ない / 空の束も「セッションはまだありません」で出る
 * ③ 行 — 番号と状態の言葉が全行に入る・下書きに「移す」を出さない
 * ④ 前面の印（active）は多くても 1 つ
 * ⑧ キーボード — Home の行を Enter で開くと会話へ戻る
 *
 * セッションは要らない（下書き 2 本と空の束で全部確かめられる・課金なし）。
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

/** コックピットのフレームを全部掴む（サイドバー・エディタタブ） */
async function cockpitFrames(page) {
	const frames = [];
	for (const frame of page.frames()) {
		try {
			if (await frame.$('#homeToggle')) {
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
		toggleTitle: document.getElementById('homeToggle').title,
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
			before.toggleTitle === 'タブとセッションの一覧（Home）',
			`閉じているときの ≡ のツールチップが違う: ${before.toggleTitle}`
		);

		// ① 開く: Home が出て会話が隠れ、ツールチップが入れ替わる
		await (await side.$('#homeToggle')).click();
		await page.waitForTimeout(600);
		const opened = await readHomeState(side);
		ctx.expect(opened.panelShown && !opened.logShown, '≡ を押しても Home と会話が入れ替わらない');
		ctx.expect(
			opened.toggleTitle === '会話へ戻る',
			`開いたときの ≡ のツールチップが違う: ${opened.toggleTitle}`
		);

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

		// ① 面をまたぐ引き継ぎ: 開いた状態でエディタタブの面を開くと、そちらも開いて出る
		await (await side.$('#homeToggle')).click();
		await page.waitForTimeout(600);
		await page.keyboard.press('F1');
		await page.waitForTimeout(600);
		await page.keyboard.type('コックピットをタブで開く', { delay: 15 });
		await page.waitForTimeout(800);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2000);
		let tabFrame;
		for (let i = 0; i < 10 && !tabFrame; i++) {
			const frames = await cockpitFrames(page);
			tabFrame = frames.find((frame) => frame !== side);
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
		await (await side.$('#homeToggle')).click();
		await page.waitForTimeout(400);
	}
};
