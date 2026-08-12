/**
 * 承認ルールの画面編集（T-028）の通し確認。
 *
 * 一覧に「そのルールが**何を許すのか**」が日本語で出ること、
 * 広いルールに飲み込まれている行が指摘されることを、実際の設定で見る。
 * 実セッション（課金）は要らない — この機能は設定しか読まないため。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export default {
	name: '承認ルールの一覧が、何を許すのかを日本語で出す',
	async run(page, ctx) {
		// ワークスペース設定にルールを仕込む（広い Read が Read(*.md) を飲み込む形）
		mkdirSync(join(ctx.workspace, '.vscode'), { recursive: true });
		writeFileSync(
			join(ctx.workspace, '.vscode/settings.json'),
			JSON.stringify({ 'nimbus.permissions.alwaysAllow': ['Read', 'Read(*.md)', 'Bash(npm test)'] }, null, 2)
		);
		// 設定を読み直させる（開き直さずに効かせるため少し待つ）
		await page.waitForTimeout(2500);

		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		await page.waitForTimeout(1000);
		await page.keyboard.type('Nimbus: 確認せずに許可するルールを編集する', { delay: 20 });
		await page.waitForTimeout(1200);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2000);

		const picker = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);

		ctx.expect(picker.includes('Bash(npm test)'), `ルールが一覧に出ていない:\n${picker.slice(0, 500)}`);
		// 書式だけでなく「何を許すのか」を出す
		ctx.expect(
			picker.includes('で始まるものを確認せず許可'),
			`何を許すのかが日本語で出ていない:\n${picker.slice(0, 500)}`
		);
		// 広いルールに飲み込まれている行を指摘する
		ctx.expect(
			picker.includes('含まれています'),
			`より広いルールに含まれている行が指摘されていない:\n${picker.slice(0, 500)}`
		);
		await ctx.shot('permission-rules');
	}
};
