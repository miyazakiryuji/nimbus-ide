/**
 * 実際に Claude と 1 往復する。課金が発生するので --with-claude を付けたときだけ走る。
 * NIMBUS_SMOKE_PROMPT を渡してあるので、起動時に自動で 1 通送られている。
 *
 * コックピットは Webview（iframe）なので、**サイドバーの innerText には出てこない**。
 * 最初はそれで落ちた（セッション自体は成功していたのに「応答が出ない」と報告された）。
 * フレームを横断して探す。
 */
async function findInAnyFrame(page, needle) {
	for (const frame of page.frames()) {
		const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
		if (text.includes(needle)) {
			return text;
		}
	}
	return undefined;
}

export default {
	name: '実セッションが往復する（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		const deadline = Date.now() + 120000;
		let hit;
		while (Date.now() < deadline) {
			hit = await findInAnyFrame(page, 'NIMBUS_GUI_OK');
			if (hit) {
				break;
			}
			await page.waitForTimeout(2000);
		}
		if (!hit) {
			// 何が出ているのかを添えて落とす（原因の切り分けに効く）
			const frames = [];
			for (const frame of page.frames()) {
				const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
				if (text.trim()) {
					frames.push(text.replace(/\s+/g, ' ').slice(0, 120));
				}
			}
			ctx.expect(false, `Claude の応答がコックピットに出ない。各フレームの中身:\n  ${frames.join('\n  ')}`);
		}
		// コスト表示まで届いているか（往復が成立した証拠）
		const status = await page.evaluate(() => document.querySelector('.part.statusbar')?.innerText ?? '');
		ctx.expect(/\$\d/.test(status), `ステータスバーにコストが出ていない: "${status}"`);
		await ctx.shot('claude-session');
	}
};
