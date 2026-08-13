/**
 * スキル・サブエージェントの下書き支援（T-031）の通し確認。
 *
 * 仕様の「画面確認: 必須を消すと保存時に指摘が出る」がこれ。
 * **実セッション（課金）は要らない** — 開いたファイルを読むだけの機能なので。
 *
 * 診断は `onDidOpenTextDocument` / `onDidSaveTextDocument` の登録漏れがあると
 * 何も出なくなるが、**モジュールテストは `validate()` しか見られない**ので気づけない。
 * ここでは実際にファイルを開いて、問題パネルに出るところまで見る。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** 問題パネル（Problems）の中身を読む */
async function problemsText(page) {
	return page.evaluate(() => {
		const panel = document.querySelector('.markers-panel, .pane-body.markers-panel-container');
		return panel ? panel.innerText : '';
	});
}

export default {
	name: 'SKILL.md の必須が欠けていると、問題として指摘される',
	async run(page, ctx) {
		// `skills/<名前>/SKILL.md` の形でないと、そもそも対象にならない
		const dir = join(ctx.workspace, '.claude', 'skills', 'sample');
		mkdirSync(dir, { recursive: true });
		// frontmatter はあるが `description` が無い（必須の欠落）
		writeFileSync(join(dir, 'SKILL.md'), '---\nname: sample\n---\n\n手順をここに書く。\n');
		await page.waitForTimeout(1000);

		// クイックオープンで開く（開いた時点で診断が走る）
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+P' : 'Control+P');
		await page.waitForTimeout(900);
		await page.keyboard.type('SKILL.md', { delay: 20 });
		await page.waitForTimeout(1400);
		await page.keyboard.press('Enter');
		await page.waitForTimeout(2000);

		// 問題パネルを開く
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+M' : 'Control+Shift+M');

		let problems = '';
		for (let i = 0; i < 14; i++) {
			await page.waitForTimeout(700);
			problems = await problemsText(page);
			if (problems.includes('description')) {
				break;
			}
		}
		ctx.expect(
			problems.includes('description'),
			`必須の欠落が問題として出ていない:\n${problems.slice(0, 500)}`
		);
		// 「何が足りないか」まで言えているか（位置より中身が要る、という設計なので）
		ctx.expect(
			problems.includes('ありません'),
			`何が足りないかが書かれていない:\n${problems.slice(0, 500)}`
		);
		await ctx.shot('authoring-diagnostics');
	}
};
