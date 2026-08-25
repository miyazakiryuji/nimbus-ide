/**
 * コミットメッセージの生成（T-305 / T-309）。
 *
 * 普段の実行で見るのは**断りかた** — staged が空のときに「先に組んでください」と言って
 * 何も起きないこと（勝手に git add しないことの裏返し）。
 *
 * 生成そのもの（型を選ぶ → 軽いモデルで 1 往復 → SCM の入力欄に入る）は課金が出るので
 * `--with-claude` のときだけ通しで押す。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, labels, notificationText, runCommand } from '../helpers.mjs';

/** SCM の入力欄の中身（monaco なので view-lines から読む） */
async function scmInputText(page) {
	return page.evaluate(() => {
		const editor = document.querySelector('.scm-view .scm-editor .monaco-editor');
		return editor ? (editor.textContent ?? '') : '';
	});
}

export default {
	name: 'コミットメッセージの生成は、staged が空なら断り、組んであれば型を選んで書く',
	async run(page, ctx) {
		// --- staged が空: 断って終わる（勝手に add しない） ---
		await runCommand(page, labels('command.generateCommitMessage')[0]);
		let refused = '';
		for (let i = 0; i < 14; i++) {
			await page.waitForTimeout(600);
			refused = await notificationText(page);
			if (refused.includes('ステージが空')) {
				break;
			}
		}
		ctx.expect(
			refused.includes('ステージが空'),
			`staged が空なのに断りが出ない: ${refused.slice(0, 300)}`
		);
		await page.keyboard.press('Escape');

		if (!ctx.withClaude) {
			return; // 生成は課金が出るのでここまで
		}

		// --- 束を組んでから生成: 型の選択 → 入力欄に入る ---
		writeFileSync(join(ctx.workspace, 'feature.ts'), 'export const feature = 1;\n');
		git(ctx.workspace, ['add', 'feature.ts']);

		await runCommand(page, labels('command.generateCommitMessage')[0]);
		// 型の picker（T-309: 生成の前に「いまの型」が出る）。先頭 = いまの型で確定
		await page.waitForTimeout(1500);
		await page.keyboard.press('Enter');

		let message = '';
		for (let i = 0; i < 60; i++) {
			await page.waitForTimeout(1000);
			message = (await scmInputText(page)).trim();
			if (message.length > 0) {
				break;
			}
		}
		ctx.expect(message.length > 0, 'SCM の入力欄にメッセージが入らない');
		await ctx.shot('commit-message');
	}
};
