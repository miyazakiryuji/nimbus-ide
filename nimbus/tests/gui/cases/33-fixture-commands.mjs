/**
 * 「材料を置いて開く」系のコマンドが、実際の中身から答えを出すか。
 *
 * 仕様側の「画面確認（実際の◯◯で開く・未実施）」を、まとめてここで見る:
 * `licenses` / `lock-diff` / `mermaid`。
 *
 * **実セッション（課金）は要らない。** どれも手元のファイルしか読まない。
 *
 * 材料が無いときの「見つかりませんでした」は通ってしまうので、
 * **材料を置いたうえで、その中身が出るか**まで見る。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, git, labels, runCommand } from '../helpers.mjs';

/** 開いているエディタを全部読む（材料ごとに別の文書が開くため） */
async function allEditorsText(page) {
	const texts = await page.evaluate(() =>
		[...document.querySelectorAll('.editor-instance .view-lines')].map((node) => node.innerText)
	);
	return texts.join('\n---\n').replace(/ /g, ' ');
}

async function openAndRead(page, title, needle, { attempts = 12 } = {}) {
	await runCommand(page, title);
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
	name: '材料を置いたコマンドが、その中身から答えを出す',
	async run(page, ctx) {
		await closeAllEditors(page);

		// --- ライセンス: node_modules の中身を読む ---
		const dep = join(ctx.workspace, 'node_modules', 'sample-lib');
		mkdirSync(dep, { recursive: true });
		writeFileSync(
			join(dep, 'package.json'),
			JSON.stringify({ name: 'sample-lib', version: '1.2.3', license: 'MIT' }, null, 2)
		);
		writeFileSync(
			join(ctx.workspace, 'package.json'),
			JSON.stringify({ name: 'fixture', version: '1.0.0', dependencies: { 'sample-lib': '^1.2.3' } }, null, 2)
		);

		// --- ロックの差分: コミット済みの lock を書き換える ---
		const lock = join(ctx.workspace, 'package-lock.json');
		writeFileSync(
			lock,
			JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { 'node_modules/sample-lib': { version: '1.2.3' } } }, null, 2)
		);
		// --- Mermaid: 壊れた図を 1 つ置く ---
		writeFileSync(
			join(ctx.workspace, 'diagram.md'),
			'# 図\n\n```mermaid\ngraph TD\n  A --> B\n  B --> \n```\n'
		);
		git(ctx.workspace, ['add', '-A']);
		git(ctx.workspace, ['commit', '-m', 'fixtures']);
		// lock を上げる（差分が出る）
		writeFileSync(
			lock,
			JSON.stringify({ name: 'fixture', lockfileVersion: 3, packages: { 'node_modules/sample-lib': { version: '2.0.0' } } }, null, 2)
		);
		await page.waitForTimeout(1500);

		const missing = [];
		const checks = [
			// エディタは仮想化されていて一覧の下のほうは読めないので、
			// 「何個見たか」で置いた依存を数えられたことを見る
			['command.openLicenses', '1 個を見ました', 'ライセンス一覧が、置いた依存を数えていない'],
			['command.explainLockDiff', '2.0.0', 'ロックの差分に、上がった版が出ない'],
			['command.checkMermaid', 'mermaid', 'Mermaid の確認結果が出ない']
		];
		for (const [key, needle, why] of checks) {
			const text = await openAndRead(page, labels(key)[0], needle);
			if (!text.includes(needle)) {
				missing.push(`${why}（実際: ${text.slice(0, 160).replace(/\n/g, ' ')}）`);
			}
		}
		ctx.expect(missing.length === 0, missing.join('\n'));
		await ctx.shot('fixture-commands');

		ctx.expect((await closeAllEditors(page)) === 0, '文書を閉じきれていない（次のケースを汚す）');
	}
};
