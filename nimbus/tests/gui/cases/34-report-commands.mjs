/**
 * 記録を読んで報告を出すコマンドが、実際に開くか。
 *
 * 仕様側の「画面確認（コマンドから開く・自分の記録で開く・未実施）」を、まとめてここで見る:
 * `digest` / `highlights` / `explain` / `prompt-stats`。
 *
 * **実セッション（課金）は要らない。** どれも過去の記録を読むだけ。
 *
 * ## ここで確かめられること・られないこと
 *
 * この環境には**この作業ツリーの記録が無い**ので、中身は
 * 「記録がありませんでした」になることがある。**それでよい。**
 * ここで捕まえたいのは、
 *
 * - コマンドの登録漏れ（`package.json` にあるのに `registerCommand` が無い）
 * - 記録が無いときの例外での早期 return（**何も開かない**）
 *
 * の 2 つで、どちらも**コンパイルもモジュールテストも通ってしまう**。
 * 中身の正しさは各 `core/*` の単体テストが見ている。
 */
import { closeAllEditors, labels, runCommand } from '../helpers.mjs';

async function allEditorsText(page) {
	const texts = await page.evaluate(() =>
		[...document.querySelectorAll('.editor-instance .view-lines')].map((node) => node.innerText)
	);
	return texts.join('\n---\n').replace(/ /g, ' ');
}

/**
 * `picks` は、コマンドの後に挟まる選択の数。
 * 例: ふりかえりは「直近何日か」を先に聞くので 1 回 Enter が要る。
 */
async function openAndRead(page, title, needle, { attempts = 10, picks = 0 } = {}) {
	await runCommand(page, title);
	for (let i = 0; i < picks; i++) {
		await page.waitForTimeout(1000);
		await page.keyboard.press('Enter');
	}
	let text = '';
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(700);
		text = await allEditorsText(page);
		if (text.includes(needle)) {
			return text;
		}
	}
	return text;
}

export default {
	name: '記録から報告を出すコマンドが、記録が無くても開く',
	async run(page, ctx) {
		await closeAllEditors(page);

		const checks = [
			['command.openDigest', 'ふりかえり', 1],
			['command.openHighlights', '切り出したやり取り', 0],
			['command.openExplanation', '何をしたか', 0],
			['command.openPromptStats', '指示の出しかた', 0]
		];

		const missing = [];
		for (const [key, needle, picks] of checks) {
			const text = await openAndRead(page, labels(key)[0], needle, { picks });
			if (!text.includes(needle)) {
				missing.push(`${key} → 「${needle}」が出ない（実際: ${text.slice(0, 140).replace(/\n/g, ' ')}）`);
			}
		}
		ctx.expect(missing.length === 0, `開かなかったコマンドがある:\n${missing.join('\n')}`);
		await ctx.shot('report-commands');

		ctx.expect((await closeAllEditors(page)) === 0, '文書を閉じきれていない（次のケースを汚す）');
	}
};
