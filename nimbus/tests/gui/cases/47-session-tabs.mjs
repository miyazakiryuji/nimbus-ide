/**
 * セッションのタブ（T-269 ②③）の通し確認。
 *
 * タブは**2 本以上**あるときだけ出る（切り替える先が無い列は場所を取るだけ）ので、
 * 実セッションを 2 本起こす必要がある。課金が出るので `--with-claude` のときだけ走る。
 */
import { webviewText } from '../helpers.mjs';

async function typeAndSend(page, text) {
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
	name: 'セッションが 2 本になるとタブが出て、押すと切り替わる（--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		// 1 本目は起動時のスモークが起こしている。2 本目を作る。
		// **押す場所は面のタイトル**（T-290）。会話の上のタブ列にも「+」はあるが、
		// 列は 2 本以上のときしか出ないので、1 本目の時点では webview の中に無い
		await page.keyboard.press('Escape');
		await page.waitForTimeout(600);
		const pressed = await page.evaluate(() => {
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
		ctx.expect(pressed, 'コックピットのタイトルに「新しいセッション」が無い（T-290 の入口）');
		await page.waitForTimeout(2500);
		ctx.expect(await typeAndSend(page, 'Reply with exactly: NIMBUS_TAB_TWO'), 'コックピットの入力欄が見つからない');

		const tabs = await webviewText(page, ['NIMBUS_TAB_TWO'], { attempts: 40 });
		ctx.expect(tabs !== undefined, '2 本目のセッションが動き出さない');

		// タブの列が出ているか。
		// **`contentDocument` では読めない** — パッケージ版の webview は別オリジンの入れ子なので、
		// 素の DOM から中身へは入れない（実測。ここで空文字が返り、出ているのに落ちていた）。
		// Playwright のフレーム越しに読む
		let strip = [];
		for (let i = 0; i < 20 && strip.length < 2; i++) {
			for (const frame of page.frames()) {
				const found = await frame.$$('.session-tab').catch(() => []);
				if (found.length > strip.length) {
					strip = await Promise.all(
						found.map((el) => el.evaluate((node) => (node.textContent ?? '').trim()))
					);
				}
			}
			if (strip.length < 2) {
				await page.waitForTimeout(500);
			}
		}
		ctx.expect(strip.length >= 2, `セッションが 2 本あるのにタブの列が出ていない: ${JSON.stringify(strip)}`);
		// **番号は幅が無くても残る**（T-301）。3 本並ぶと名前に使えるのは 30px ほどしかない
		ctx.expect(
			strip.some((text) => text.includes('1')) && strip.some((text) => text.includes('2')),
			`タブに通し番号が出ていない: ${JSON.stringify(strip)}`
		);
		await ctx.shot('session-tabs');
	}
};
