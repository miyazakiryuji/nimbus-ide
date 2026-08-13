/**
 * フックのドライラン（T-161）の通し確認。
 *
 * 仕様の「画面確認: ドライランで止まるフックが『止めた』と出る」がこれ。
 * **実セッション（課金）は要らない** — フックを 1 本その場で実行するだけなので。
 *
 * ここは**本当に子プロセスを起こして終了コードを見ている**ので、
 * 「止まるはずのフックが止まらない」を実際に捕まえられる。
 * 単体テストは `interpretExitCode` の対応表しか見られない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeEditorText, labels, runCommand } from '../helpers.mjs';

export default {
	name: 'ドライランで、止まるフックが「止めた」と出る',
	async run(page, ctx) {
		// 止めるフック（終了コード 2）を 1 本仕込む
		mkdirSync(join(ctx.workspace, '.claude'), { recursive: true });
		writeFileSync(
			join(ctx.workspace, '.claude', 'settings.json'),
			JSON.stringify(
				{
					hooks: {
						PreToolUse: [
							{ matcher: 'Bash', hooks: [{ type: 'command', command: 'exit 2' }] }
						]
					}
				},
				null,
				2
			)
		);
		await page.waitForTimeout(1500);

		await runCommand(page, labels('command.hookDryRun')[0]);
		// 「どのフックを試しますか」— 1 本しかないので、そのまま選ぶ
		await page.waitForTimeout(1200);
		await page.keyboard.press('Enter');

		// 結果は Markdown で開く（子プロセスの終了を待つので、出るまで見に行く）
		let report = '';
		for (let i = 0; i < 14; i++) {
			await page.waitForTimeout(700);
			report = await activeEditorText(page);
			if (report.includes('ドライラン')) {
				break;
			}
		}
		ctx.expect(
			report.includes('ドライラン'),
			`ドライランの結果が開かれていない:\n${report.slice(0, 400)}`
		);
		ctx.expect(
			report.includes('止めた'),
			`終了コード 2 のフックが「止めた」と出ていない:\n${report.slice(0, 600)}`
		);
		// 本番と同じ形の入力を渡したことも見せる（渡す形が違えば試す意味がない）
		ctx.expect(
			report.includes('PreToolUse'),
			`渡した入力にイベント名が出ていない:\n${report.slice(0, 600)}`
		);
		await ctx.shot('hook-dry-run');
	}
};
