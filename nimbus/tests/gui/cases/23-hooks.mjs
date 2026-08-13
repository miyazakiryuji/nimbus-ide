/**
 * フックの組み立て（T-026）の通し確認。
 *
 * 仕様の「画面確認: フックを足して `settings.json` に書かれる」がこれ。
 * **実セッション（課金）は要らない** — 設定ファイルを書くだけの機能なので。
 *
 * 画面の文字ではなく**ディスクに書かれた JSON** を見る。
 * 画面は文言が変わると壊れるが、書かれた設定は仕様そのものなので壊れにくい。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, runCommand } from '../helpers.mjs';

/** QuickPick / InputBox が出るのを待ってから打つ */
async function typeAndEnter(page, text, { delay = 900 } = {}) {
	await page.waitForTimeout(delay);
	if (text) {
		await page.keyboard.type(text, { delay: 20 });
		await page.waitForTimeout(400);
	}
	await page.keyboard.press('Enter');
}

export default {
	name: 'フックを足すと .claude/settings.json に書かれる',
	async run(page, ctx) {
		const settingsPath = join(ctx.workspace, '.claude', 'settings.json');

		// runCommand は真偽を返さない（実行できたかは、書かれた設定で判断する）
		await runCommand(page, labels('command.hooks')[0]);

		// 1) 「フックを足す」を選ぶ（一覧の先頭にある）
		await typeAndEnter(page, 'フックを足す', { delay: 1200 });
		// 2) タイミング（PreToolUse は一覧の先頭・matcher を聞かれる種類）
		await typeAndEnter(page, 'PreToolUse');
		// 3) どのツールに効かせるか
		await typeAndEnter(page, 'Bash');
		// 4) 走らせるコマンド
		await typeAndEnter(page, 'exit 2');

		// 書き込みは非同期なので、出来上がるまで少し待つ
		let written = '';
		for (let i = 0; i < 12; i++) {
			await page.waitForTimeout(500);
			if (existsSync(settingsPath)) {
				written = readFileSync(settingsPath, 'utf8');
				if (written.includes('exit 2')) {
					break;
				}
			}
		}
		ctx.expect(written.length > 0, `${settingsPath} が作られていない`);

		const parsed = JSON.parse(written);
		const pre = parsed?.hooks?.PreToolUse;
		ctx.expect(Array.isArray(pre) && pre.length > 0, `hooks.PreToolUse が無い:\n${written}`);
		ctx.expect(
			JSON.stringify(pre).includes('exit 2') && JSON.stringify(pre).includes('Bash'),
			`足したコマンドと matcher が入っていない:\n${written}`
		);
		await ctx.shot('hooks-written');
	}
};
