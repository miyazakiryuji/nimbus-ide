/**
 * テンプレートから CLAUDE.md を作る（T-319）。
 *
 * 押して動くところまで: 階層を選ぶ → テンプレートを選ぶ → ファイルができて開く。
 * 実セッションは要らない（数えるのも書くのも手元だけ）。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, labels, runCommand } from '../helpers.mjs';

export default {
	name: 'CLAUDE.md がテンプレートから作られ、開いて読める',
	async run(page, ctx) {
		await closeAllEditors(page);

		await runCommand(page, labels('command.createClaudeMd')[0]);
		// 階層（先頭 = このプロジェクト）
		await page.waitForTimeout(1200);
		await page.keyboard.press('Enter');
		// テンプレート（先頭 = おすすめ）
		await page.waitForTimeout(1200);
		await page.keyboard.press('Enter');

		const path = join(ctx.workspace, 'CLAUDE.md');
		let created = false;
		for (let i = 0; i < 16 && !created; i++) {
			await page.waitForTimeout(500);
			created = existsSync(path);
		}
		ctx.expect(created, 'CLAUDE.md が作られない');

		const content = readFileSync(path, 'utf8');
		ctx.expect(
			content.startsWith('# ') && content.includes('## 走らせ方'),
			`テンプレートの形になっていない:\n${content.slice(0, 200)}`
		);
		// 分からないところは TODO（推測を書き込まない）
		ctx.expect(content.includes('TODO'), 'TODO の足場が無い（埋め草だけの文になっている）');

		// 作ったら開いて読ませる
		const tab = await page.evaluate(() =>
			[...document.querySelectorAll('.tabs-container .tab')].map((el) => el.textContent ?? '').join(' | ')
		);
		ctx.expect(tab.includes('CLAUDE.md'), `作ったファイルが開かれていない: ${tab.slice(0, 200)}`);
		await ctx.shot('claude-md-create');
	}
};
