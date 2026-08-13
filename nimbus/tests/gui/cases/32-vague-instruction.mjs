/**
 * 曖昧な日本語の指示を、送る前に一度だけ聞き返す（T-090）の通し確認。
 *
 * 仕様の「画面確認: 『それを直して』と打つと確認が出る」がこれ。
 * **実セッション（課金）は要らない** — 送る**手前**で止まるかを見るので。
 *
 * ## 確認の文言そのものは、ここでは読めない
 *
 * `showWarningMessage({ modal: true })` はデスクトップでは OS のネイティブダイアログになり、
 * **中身が DOM に入らない**（`31-local-only-and-settings.mjs` で実測）。
 * 文言（何を聞き返すか）は `core/ambiguity.ts` の単体テストで押さえてある。
 *
 * ここで確かめるのは、単体テストでは絶対に分からない 2 つ:
 *
 * 1. **判定が送信経路に実際に繋がっているか**（`checkBeforeSending` の配線）
 * 2. **閉じたときに送られないか**（止めないが、勝手に送りもしない）
 */
import { openNimbusSidebar } from '../helpers.mjs';

/**
 * コックピットの入力欄（Webview の中）に打ち込む。
 *
 * **最初に見つかった textarea を掴んではいけない。** 右側の Chat パネルにも
 * 入力欄があり、そちらを掴むと何も起きないまま「聞き返さない」ように見える（実際にそうなった）。
 * 案内文でコックピットのものだけを選ぶ。
 */
async function typeInCockpit(page, text) {
	for (const frame of page.frames()) {
		const isCockpit = await frame
			.evaluate(() => {
				const area = document.querySelector('textarea');
				return Boolean(area && (area.placeholder ?? '').includes('Claude に指示'));
			})
			.catch(() => false);
		if (!isCockpit) {
			continue;
		}
		await frame.fill('textarea', text).catch(() => undefined);
		await page.waitForTimeout(400);
		await frame.press('textarea', 'Enter').catch(() => undefined);
		return true;
	}
	return false;
}

async function modalOpen(page) {
	return page.evaluate(
		() => document.querySelector('.monaco-workbench')?.classList.contains('modal-dialog-visible') ?? false
	);
}

export default {
	name: '曖昧な指示は、送る前に一度だけ聞き返す',
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		await page.waitForTimeout(1200);

		// 対象の書かれていない指示語だけの指示（`core/ambiguity.ts` の demonstrative）
		ctx.expect(await typeInCockpit(page, 'それを直して'), 'コックピットの入力欄が見つからない');

		let asked = false;
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(600);
			asked = await modalOpen(page);
			if (asked) {
				break;
			}
		}
		ctx.expect(asked, '曖昧な指示なのに、聞き返さずに送ろうとしている');
		await ctx.shot('vague-instruction');

		// 閉じる（＝送らないほうを選ぶ）
		await page.keyboard.press('Escape');
		await page.waitForTimeout(2000);

		// セッションが始まっていないこと。始まっていれば「セッション未開始」が消える
		const sidebar = await page.evaluate(() => {
			const pane = document.querySelector('.pane-body');
			return pane ? pane.innerText : '';
		});
		ctx.expect(
			!sidebar.includes('実行中'),
			`確認を閉じたのにセッションが始まっている:\n${sidebar.slice(0, 300)}`
		);
	}
};
