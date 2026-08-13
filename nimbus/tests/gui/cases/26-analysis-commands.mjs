/**
 * 作業ツリーを読むだけの分析コマンドが、実際に開いて中身を出すか。
 *
 * 仕様側の「画面確認（コマンドから開く・未実施）」を、まとめてここで見る:
 * `branch-health` / `code-health` / `change-stats` / `env-check`。
 *
 * **実セッション（課金）は要らない。** どれも git と手元のファイルしか読まない。
 *
 * コマンドの登録漏れ・例外での早期 return は、
 * コンパイルもモジュールテストも通ってしまう。**開いて中身が出るか**は画面でしか分からない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, labels, runCommand } from '../helpers.mjs';

/**
 * 開いているエディタを**すべて**読む。
 *
 * `activeEditorText` は最初のエディタしか見ないので、
 * 続けて開くとタブが積み上がって 2 つ目以降が「開かなかった」ように見える（実際にそうなった）。
 * タブを閉じて回るより、全部読んで探すほうが確実。
 */
async function allEditorsText(page) {
	const texts = await page.evaluate(() =>
		[...document.querySelectorAll('.editor-instance .view-lines')].map((node) => node.innerText)
	);
	return texts.join('\n---\n').replace(/\u00a0/g, ' ');
}

/** コマンドを走らせて、開いた文書に見出しが出るまで待つ */
async function openAndRead(page, title, heading, { attempts = 12 } = {}) {
	await runCommand(page, title);
	let text = '';
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(700);
		text = await allEditorsText(page);
		if (text.includes(heading)) {
			return text;
		}
	}
	return text;
}

export default {
	name: '分析コマンドが、実際の作業ツリーから中身を出す',
	async run(page, ctx) {
		// git の履歴と、未コミットの変更を作る（どのコマンドもここを読む）
		mkdirSync(join(ctx.workspace, 'src'), { recursive: true });
		writeFileSync(join(ctx.workspace, 'src/a.ts'), 'export function alpha() {\n\treturn 1;\n}\n');
		writeFileSync(join(ctx.workspace, 'src/b.ts'), 'export function beta() {\n\treturn 2;\n}\n');
		writeFileSync(join(ctx.workspace, 'package.json'), JSON.stringify({ name: 'sample', version: '1.0.0' }, null, 2));
		git(ctx.workspace, ['add', '-A']);
		git(ctx.workspace, ['commit', '-m', 'first']);
		// 「ブランチのようす」は比べる先が要る。main 上では
		// 「作業ブランチで実行してください」と言って開かない（仕様どおり）ので、分岐しておく
		git(ctx.workspace, ['branch', '-M', 'main']);
		git(ctx.workspace, ['checkout', '-b', 'feature/sample']);
		writeFileSync(join(ctx.workspace, 'src/c.ts'), 'export function gamma() {\n\treturn 3;\n}\n');
		git(ctx.workspace, ['add', '-A']);
		git(ctx.workspace, ['commit', '-m', 'on branch']);
		// 未コミットの変更を残す（「変更のようす」が見るもの）
		writeFileSync(join(ctx.workspace, 'src/a.ts'), 'export function alpha() {\n\treturn 42;\n}\n');
		await page.waitForTimeout(1200);

		const checks = [
			['command.openBranchHealth', 'ブランチのようす'],
			['command.openChangeStats', '変更のようす'],
			['command.openCodeHealth', '命名と重複'],
			['command.openEnvCheck', '環境の食い違い']
		];

		const missing = [];
		for (const [key, heading] of checks) {
			const text = await openAndRead(page, labels(key)[0], heading);
			if (!text.includes(heading)) {
				missing.push(`${key} → 「${heading}」が出ない（実際: ${text.slice(0, 120).replace(/\n/g, ' ')}）`);
			}
		}
		ctx.expect(missing.length === 0, `開かなかったコマンドがある:\n${missing.join('\n')}`);
		await ctx.shot('analysis-commands');
	}
};
