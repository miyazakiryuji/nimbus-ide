/**
 * セッションのタブ（T-269 ②③）の通し確認。
 *
 * タブは**2 本以上**あるときだけ出る（切り替える先が無い列は場所を取るだけ）ので、
 * 実セッションを 2 本起こす必要がある。課金が出るので `--with-claude` のときだけ走る。
 *
 * T-314 から、**狭いサイドバーでは列を並べず ≡（Home）に畳む**。
 * 列そのものは Home の行として読む（番号が残ることの確認は同じ）。
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

		// 狭いサイドバーでは ≡ に畳まれる（T-314）ので、≡ を押して Home の行として読む。
		// **`contentDocument` では読めない** — パッケージ版の webview は別オリジンの入れ子なので、
		// まず**タブ列そのもの**が見えて、押して切り替わること（T-338）。
		// 以前は CSS で隠れていても textContent が読めたせいで、列が消えたまま緑が続いた。
		// 存在ではなく可視性（offsetParent / offsetHeight）で確かめる
		let stripVisible = false;
		for (let i = 0; i < 16 && !stripVisible; i++) {
			for (const frame of page.frames()) {
				stripVisible = await frame
					.$eval('#sessionTabs', (el) => !el.hidden && el.offsetParent !== null && el.offsetHeight > 0)
					.catch(() => false);
				if (stripVisible) {
					break;
				}
			}
			if (!stripVisible) {
				await page.waitForTimeout(500);
			}
		}
		ctx.expect(stripVisible, 'セッションが 2 本あるのにタブ列が**見えて**いない（CSS の畳みが復活している）');
		for (const frame of page.frames()) {
			const rows = await frame.$$('.session-tab').catch(() => []);
			if (rows.length >= 2) {
				await rows[0].click();
				await page.waitForTimeout(1500);
				const flipped = await frame
					.$eval('.session-tab', (el) => el.classList.contains('active'))
					.catch(() => false);
				ctx.expect(flipped, 'タブ列の 1 枚目を押しても前面が移らない');
				break;
			}
		}

		// Home を開く。**≡ は廃止された**（T-345 / `d02cd68fc1f`）ので、入口は面のタイトル。
		// 素の DOM から webview の中身へは入れない（実測）ので、押すのはタイトル側
		await page.evaluate(() => {
			const found = [
				...document.querySelectorAll(
					'.part.sidebar .composite.title .actions-container a, .part.sidebar .composite.title .action-label'
				)
			].find((el) =>
				`${el.getAttribute('aria-label') ?? ''} ${el.getAttribute('title') ?? ''}`.includes('一覧（Home）')
			);
			found?.click();
		});
		let strip = [];
		for (let i = 0; i < 20 && strip.length < 2; i++) {
			for (const frame of page.frames()) {
				const found = await frame.$$('.home-session').catch(() => []);
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
		ctx.expect(strip.length >= 2, `セッションが 2 本あるのに Home に行が出ていない: ${JSON.stringify(strip)}`);
		// **番号は幅が無くても残る**（T-301）。3 本並ぶと名前に使えるのは 30px ほどしかない
		ctx.expect(
			strip.some((text) => text.includes('1')) && strip.some((text) => text.includes('2')),
			`タブに通し番号が出ていない: ${JSON.stringify(strip)}`
		);
		await ctx.shot('session-tabs');
	}
};
