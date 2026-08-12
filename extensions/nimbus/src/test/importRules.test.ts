/**
 * 他のツールの設定の取り込み。
 *
 * **中身を変換しない**ことと、**出どころを必ず書く**ことが要件。
 * どこから来た指示か分からないルールは、あとで消せなくなる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { convertToClaudeMd, describeImport, stripFrontmatter, toolOf } from '../core/importRules';

test('知っている設定ファイルを見分ける', () => {
	assert.deepStrictEqual(
		[
			'.cursorrules',
			'.cursor/rules/style.mdc',
			'.github/copilot-instructions.md',
			'.github/instructions/test.instructions.md',
			'.windsurfrules',
			'README.md'
		].map(toolOf),
		['Cursor', 'Cursor', 'GitHub Copilot', 'GitHub Copilot', 'Windsurf', undefined]
	);
});

test('frontmatter は落とす（Claude Code は読まない）', () => {
	assert.strictEqual(stripFrontmatter('---\ndescription: x\n---\n\n本文'), '本文');
	assert.strictEqual(stripFrontmatter('本文だけ'), '本文だけ');
	assert.strictEqual(stripFrontmatter('---\n閉じていない'), '---\n閉じていない');
});

test('出どころを添えて並べる。中身は変えない', () => {
	const converted = convertToClaudeMd(
		[
			{ path: '.cursorrules', text: 'タブを使う。' },
			{ path: '.github/copilot-instructions.md', text: '---\nx: 1\n---\nテストを書く。' }
		],
		'2026-08-13'
	);
	assert.ok(converted.startsWith('## 他のツールから取り込んだ指示\n'), converted);
	assert.ok(converted.includes('（2026-08-13 に Nimbus が取り込みました。**中身は変換していません。**'), converted);
	assert.ok(converted.includes('### .cursorrules（Cursor）'), converted);
	assert.ok(converted.includes('タブを使う。'), converted);
	assert.ok(converted.includes('### .github/copilot-instructions.md（GitHub Copilot）'), converted);
	assert.ok(converted.includes('テストを書く。'), converted);
	assert.ok(!converted.includes('x: 1'), converted);
});

test('中身が空のものは足さない', () => {
	assert.strictEqual(convertToClaudeMd([{ path: '.cursorrules', text: '---\nx: 1\n---\n\n  ' }], '2026-08-13'), '');
	assert.strictEqual(convertToClaudeMd([], '2026-08-13'), '');
});

test('一覧は件数と行数を出す。無ければ探した先を言う', () => {
	assert.strictEqual(
		describeImport([{ path: '.cursorrules', text: 'a\nb' }]),
		['1 件の設定が見つかりました', '  .cursorrules（Cursor） — 2 行'].join('\n')
	);
	assert.ok(describeImport([]).includes('.cursorrules / copilot-instructions.md'));
});
