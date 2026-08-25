/**
 * 競合の頭に「Claude に相談」が出る（T-308）。
 *
 * コマンドは前から在った（T-115）。無かったのは**入口**なので、
 * ここで見るのは「競合マーカーのあるファイルを開いたら、その行に押せる口が出る」こと。
 *
 * 押すと相談文が**実セッションへ**送られる（課金）ので、押すところまでは
 * `--with-claude` のときだけ。普段の実行では出ることまでを確かめる。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, webviewText } from '../helpers.mjs';

const CONFLICT = [
	'plain 1',
	'<<<<<<< HEAD',
	'こちらの変更',
	'=======',
	'むこうの変更',
	'>>>>>>> feature/x',
	'plain 2',
	''
].join('\n');

/** 画面に出ている CodeLens の文字 */
async function lensText(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.codelens-decoration')].map((el) => el.textContent ?? '').join(' | ')
	);
}

export default {
	name: '競合の頭に「Claude に相談」が出て、押すと相談文が送られる',
	async run(page, ctx) {
		await closeAllEditors(page);
		const file = join(ctx.workspace, 'conflicted.txt');
		writeFileSync(file, CONFLICT);

		// ファイルを開く（Quick Open。ファイル名で当てる）
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
		await page.waitForTimeout(600);
		await page.keyboard.type('conflicted.txt', { delay: 20 });
		await page.waitForTimeout(800);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(1500);

		let lenses = '';
		for (let i = 0; i < 16; i++) {
			await page.waitForTimeout(500);
			lenses = await lensText(page);
			if (lenses.includes('Claude に相談')) {
				break;
			}
		}
		ctx.expect(
			lenses.includes('Claude に相談'),
			`競合マーカーの行に「Claude に相談」が出ない: ${lenses.slice(0, 300)}`
		);
		await ctx.shot('conflict-lens');

		if (!ctx.withClaude) {
			return; // 押すと実セッションが走る（課金）ので、ここまで
		}

		// 押す。相談文（両側を貼った文）がコックピットの会話に出るはず
		await page.evaluate(() => {
			const lens = [...document.querySelectorAll('.codelens-decoration a')].find((el) =>
				(el.textContent ?? '').includes('Claude に相談')
			);
			if (lens) {
				lens.click();
			}
		});
		const sent = await webviewText(page, ['コンフリクトが起きています'], { attempts: 30 });
		ctx.expect(
			Boolean(sent),
			'押しても相談文がコックピットに現れない'
		);
	}
};
