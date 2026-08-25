/**
 * 信頼していないフォルダでの見え方（実機で見つかった落とし穴・T-241 の守り）。
 *
 * Nimbus は `untrustedWorkspaces.supported: limited` なので、**信頼していないフォルダでも
 * アクティビティバーから消えない**。実行しようとした時点で理由を出して断る。
 * かつて `false` にしていた頃は拡張ごと無効になり、利用者からは「フォルダを開いたら
 * Nimbus が無くなった」に見えていた（実際にそう報告された）。ここはその再発を止める番人。
 *
 * このケースだけは `--disable-workspace-trust` を**渡さずに**起動する（`untrusted: true`）。
 * 既定の起動でフラグを外すと 21 件すべてがモーダル待ちになって不安定になるので、
 * フラグは残したまま、この道を通るケースを 1 本だけ別に走らせる形にしてある。
 *
 *   node nimbus/tests/gui/run.mjs --untrusted
 */

/** アクティビティバーに Nimbus のアイコンがあるか */
async function hasNimbusIcon(page) {
	return page.evaluate(() => {
		const bar = document.querySelector('.activitybar');
		if (!bar) {
			return false;
		}
		return [...bar.querySelectorAll('[aria-label], [title]')].some((el) =>
			/nimbus/i.test(`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`)
		);
	});
}

export default {
	name: '信頼していないフォルダでも消えず、実行だけを断る',
	untrusted: true,
	async run(page, ctx) {
		// 以前は「信頼していないと拡張ごと無効になり、アイコンごと消える」ことを正しい振る舞いとしていた。
		// しかし利用者からは「フォルダを開いたら Nimbus が無くなった」に見え、理由も直しかたも分からない。
		// 今は制限モードでも画面は開き、実行しようとした時点で断る（untrustedWorkspaces: limited）。
		ctx.expect(
			await hasNimbusIcon(page),
			'信頼していないだけで Nimbus のアイコンごと消えている（利用者には「壊れた」と見える）'
		);
		await ctx.shot('trust-before');

		// 制限モードであることが画面のどこかに出ているはず（利用者が気づく手がかり）
		const shell = await page.evaluate(() => document.body.innerText ?? '');
		ctx.expect(
			/制限モード|Restricted Mode/i.test(shell),
			`制限モードの表示が見当たらない（利用者が理由に気づけない）:\n${shell.slice(0, 300)}`
		);
	}
};
