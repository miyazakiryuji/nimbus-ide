/**
 * 信頼していないフォルダでの見え方（実機で見つかった落とし穴）。
 *
 * Nimbus は `untrustedWorkspaces.supported: false`（Claude Code を実行するので当然）なので、
 * **信頼していないフォルダではアクティビティバーにアイコンごと出ない**。
 * 利用者からは「**入れたのに何も起きない**」に見え、リモート接続では初回に必ず通る道になる。
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
	name: '信頼していないフォルダでは出ず、信頼すると出る',
	untrusted: true,
	async run(page, ctx) {
		// ここが本体。「出ないこと」を確かめるテストは書き忘れやすい
		ctx.expect(
			!(await hasNimbusIcon(page)),
			'信頼していないのに Nimbus のアイコンが出ている（untrustedWorkspaces の設定が効いていない）'
		);
		await ctx.shot('trust-before');

		// 制限モードであることが画面のどこかに出ているはず（利用者が気づく手がかり）
		const shell = await page.evaluate(() => document.body.innerText ?? '');
		ctx.expect(
			/制限モード|Restricted Mode/i.test(shell),
			`制限モードの表示が見当たらない（利用者が理由に気づけない）:\n${shell.slice(0, 300)}`
		);

		// 信頼して、出るようになることを確かめる
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		await page.waitForTimeout(1000);
		await page.keyboard.type('Workspaces: Manage Workspace Trust', { delay: 20 });
		await page.waitForTimeout(1200);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2500);

		// 信頼するボタンを押す（コアの文言なので日本語・英語の両方を見る）
		const trusted = await page.evaluate(() => {
			const buttons = [...document.querySelectorAll('.workspace-trust-editor button, .monaco-button')];
			const target = buttons.find((b) => /信頼|Trust/i.test(b.textContent ?? ''));
			if (!target) {
				return false;
			}
			target.click();
			return true;
		});
		ctx.expect(trusted, '信頼するボタンが見つからない（信頼の画面が開いていない可能性）');

		// 拡張が読み込まれるまで待つ
		for (let i = 0; i < 15; i++) {
			if (await hasNimbusIcon(page)) {
				break;
			}
			await page.waitForTimeout(1000);
		}
		ctx.expect(await hasNimbusIcon(page), '信頼したのに Nimbus のアイコンが出てこない');
		await ctx.shot('trust-after');
	}
};
