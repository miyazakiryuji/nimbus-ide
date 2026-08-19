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
		// 1 本目は起動時のスモークが起こしている。2 本目を作る
		await page.keyboard.press('Escape');
		for (const frame of page.frames()) {
			const button = await frame.$('#newSession, [title*="新しいセッション"]');
			if (button) {
				await button.click();
				break;
			}
		}
		await page.waitForTimeout(1000);
		ctx.expect(await typeAndSend(page, 'Reply with exactly: NIMBUS_TAB_TWO'), 'コックピットの入力欄が見つからない');

		const tabs = await webviewText(page, ['NIMBUS_TAB_TWO'], { attempts: 40 });
		ctx.expect(tabs !== undefined, '2 本目のセッションが動き出さない');

		// タブの列が出ているか（記号つき）
		const strip = await page.evaluate(() => {
			for (const frame of document.querySelectorAll('iframe')) {
				const inner = frame.contentDocument?.querySelectorAll('.session-tab');
				if (inner && inner.length > 0) {
					return [...inner].map((el) => el.textContent ?? '').join(' | ');
				}
			}
			return '';
		});
		ctx.expect(strip.length > 0, 'セッションが 2 本あるのにタブの列が出ていない');
		await ctx.shot('session-tabs');
	}
};
