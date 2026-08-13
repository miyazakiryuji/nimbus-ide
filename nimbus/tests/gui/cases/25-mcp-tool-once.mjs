/**
 * MCP ツールの単体実行（T-235）の通し確認。
 *
 * 仕様の「画面確認: コマンドパレットから呼び、`nimbus_lsp` のツールを 1 つ実行する」がこれ。
 *
 * **エージェントを介さないので、API も課金も発生しない。**
 * プロセス内の MCP サーバーへ `InMemoryTransport` で直接繋いでいることを、
 * 実際に 1 回呼んで確かめる。単体テストは引数の組み立てまでしか見られない。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { activeEditorText, labels, runCommand } from '../helpers.mjs';

export default {
	name: 'MCP ツールを、エージェント抜きで 1 回だけ呼べる',
	async run(page, ctx) {
		// LSP のツールが対象を持てるように、実ファイルを 1 つ置く
		const target = join(ctx.workspace, 'sample.ts');
		writeFileSync(target, 'export function greet(name: string): string {\n\treturn `hi ${name}`;\n}\n');
		await page.waitForTimeout(1200);

		await runCommand(page, labels('command.runMcpTool')[0]);

		// サーバーが 2 つ（nimbus_lsp / nimbus_debug）あるときは選ばせる。
		// 1 つのときは飛ばされるので、どちらでも進むように Enter を送る
		await page.waitForTimeout(1500);
		await page.keyboard.press('Enter');

		// ツールの一覧 → 先頭を選ぶ
		await page.waitForTimeout(1500);
		const picker = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		ctx.expect(
			picker.length > 0,
			'ツールの一覧が出ていない（プロセス内の MCP サーバーへ繋げていない可能性がある）'
		);
		await page.keyboard.press('Enter');

		// 引数をスキーマから聞いてくる。必須はファイルのパスなので、置いたファイルを渡す
		await page.waitForTimeout(1200);
		await page.keyboard.type(target, { delay: 10 });
		await page.waitForTimeout(400);
		await page.keyboard.press('Enter');

		// 任意項目が続くことがあるので、数回 Enter で流す
		for (let i = 0; i < 4; i++) {
			await page.waitForTimeout(600);
			await page.keyboard.press('Enter');
		}

		// 結果は Markdown で開く
		let report = '';
		for (let i = 0; i < 14; i++) {
			await page.waitForTimeout(700);
			report = await activeEditorText(page);
			if (report.includes('渡した引数')) {
				break;
			}
		}
		ctx.expect(
			report.includes('渡した引数'),
			`単体実行の結果が開かれていない:\n${report.slice(0, 500)}`
		);
		// 引数を載せないと再現できないので、そこも見る
		ctx.expect(
			report.includes('返ってきたもの'),
			`結果の節が出ていない:\n${report.slice(0, 600)}`
		);
		await ctx.shot('mcp-tool-once');
	}
};
