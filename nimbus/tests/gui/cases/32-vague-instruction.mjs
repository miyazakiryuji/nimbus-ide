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
 *
 * ## 既定では出さない（T-268）
 *
 * 送るたびに割り込むのが煩わしいという声で、聞き返しは**既定 off** にした。
 * 機能は残してあるので、ここでは**設定で on にしてから**確かめる。
 * 既定のまま試すと「聞き返さない」のが正しい振る舞いになってしまい、配線が切れても気づけない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
		// 既定 off（T-268）。この経路を通すために、このケースだけ on に戻す
		mkdirSync(join(ctx.workspace, '.vscode'), { recursive: true });
		writeFileSync(
			join(ctx.workspace, '.vscode', 'settings.json'),
			JSON.stringify({ 'nimbus.dialogue.confirmVaguePrompt': true, 'nimbus.clarifyVagueJapanese': true }, null, '\t')
		);
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		await page.waitForTimeout(2500);

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

		// **セッションが始まっていないこと。** ここが空砲だと、閉じたのに送られて
		// 課金まで走っても緑になる（実際に起きた — pane-body は webview の外なので
		// 何も読めておらず、必ず通っていた）。コックピットの webview の中を読む
		let composer = '';
		for (const frame of page.frames()) {
			const body = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => '');
			if (body.includes('Claude に指示')) {
				composer = body;
				break;
			}
		}
		ctx.expect(composer.length > 0, 'コックピットの webview が読めない');
		ctx.expect(
			composer.includes('セッション未開始'),
			`確認を閉じたのにセッションが始まっている（課金の漏れ）:\n${composer.slice(0, 300)}`
		);

		// **後始末: 入力欄を空にする。** 取りやめで文が残るのは仕様（書き直すため）だが、
		// スイートでは後続ケースの迷い Enter が残った文を発射して**課金が漏れた**（実測）。
		for (const frame of page.frames()) {
			const cleared = await frame
				.evaluate(() => {
					const area = document.querySelector('textarea');
					if (area && (area.placeholder ?? '').includes('Claude に指示')) {
						area.value = '';
						area.dispatchEvent(new Event('input', { bubbles: true }));
						return true;
					}
					return false;
				})
				.catch(() => false);
			if (cleared) {
				break;
			}
		}
	}
};
