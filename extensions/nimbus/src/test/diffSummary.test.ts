/**
 * 差分のセマンティック要約（T-157）の単体テスト。
 *
 * 要約は「読む前の見取り図」なので、**間違ったことを言わない**ことが値打ちを決める。
 * とくに「消えて足された（＝中身の変更）」を「消した／足した」と出すと、
 * API が壊れたように読めてしまうので、そこを重点的に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { apiChanges, formatSummary, roleOf, sortSummaries, summarizeDiff } from '../core/diffSummary';

const DIFF = [
	'diff --git a/extensions/nimbus/src/core/foo.ts b/extensions/nimbus/src/core/foo.ts',
	'--- a/extensions/nimbus/src/core/foo.ts',
	'+++ b/extensions/nimbus/src/core/foo.ts',
	'@@ -1,3 +1,4 @@',
	'+export function added(): void {}',
	'-export function gone(): void {}',
	' unchanged',
	'+  const local = 1;',
	''
].join('\n');

test('ファイルの役どころを見分ける', () => {
	assert.deepStrictEqual(
		[
			'extensions/nimbus/src/core/foo.ts',
			'extensions/nimbus/src/test/foo.test.ts',
			'nimbus/docs/specs/foo.md',
			'extensions/nimbus/package.json',
			'src/vs/workbench/foo.ts',
			'resources/icon.svg'
		].map(roleOf),
		['implementation', 'test', 'spec', 'config', 'core', 'other']
	);
});

test('増減の行数と、増えた／消えた宣言を拾う', () => {
	const [file] = summarizeDiff(DIFF);
	assert.deepStrictEqual(
		[file.path, file.added, file.removed, file.symbols],
		[
			'extensions/nimbus/src/core/foo.ts',
			2,
			1,
			[
				{ kind: 'function', name: 'added', change: 'added', exported: true },
				{ kind: 'function', name: 'gone', change: 'removed', exported: true }
			]
		]
	);
});

test('`+++` / `---` のヘッダを行数に数えない', () => {
	// ヘッダを数えると、1 行も変えていないファイルが「+1 −1」に見える
	const [file] = summarizeDiff(
		['diff --git a/a.ts b/a.ts', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1 @@', ' same'].join('\n')
	);
	assert.deepStrictEqual([file.added, file.removed], [0, 0]);
});

test('消えて足された宣言は「変更」として扱い、増減には出さない（ここが要）', () => {
	// 中身を直しただけの関数を「消した」と出すと、API が壊れたように読める
	const diff = [
		'diff --git a/a.ts b/a.ts',
		'-export function same(): void { return 1; }',
		'+export function same(): void { return 2; }'
	].join('\n');
	assert.deepStrictEqual(summarizeDiff(diff)[0].symbols, []);
});

test('新規・削除のファイルが分かる', () => {
	const created = summarizeDiff(['diff --git a/a.ts b/a.ts', 'new file mode 100644', '+x'].join('\n'))[0];
	const deleted = summarizeDiff(['diff --git a/b.ts b/b.ts', 'deleted file mode 100644', '-x'].join('\n'))[0];
	assert.deepStrictEqual(
		[created.isNew, created.isDeleted, deleted.isNew, deleted.isDeleted],
		[true, false, false, true]
	);
});

test('export でない宣言は API の変化に数えない', () => {
	const diff = ['diff --git a/a.ts b/a.ts', '+function helper(): void {}', '+export const shown = 1;'].join('\n');
	assert.deepStrictEqual(
		apiChanges(summarizeDiff(diff)).map((s) => s.name),
		['shown']
	);
});

test('読む順は 実装 → テスト → 設定 → コア → 仕様', () => {
	const diff = [
		'diff --git a/nimbus/docs/specs/x.md b/nimbus/docs/specs/x.md',
		'+doc',
		'diff --git a/src/vs/a.ts b/src/vs/a.ts',
		'+core',
		'diff --git a/extensions/nimbus/src/test/x.test.ts b/extensions/nimbus/src/test/x.test.ts',
		'+t',
		'diff --git a/extensions/nimbus/src/x.ts b/extensions/nimbus/src/x.ts',
		'+impl'
	].join('\n');
	assert.deepStrictEqual(
		sortSummaries(summarizeDiff(diff)).map((f) => f.role),
		['implementation', 'test', 'core', 'spec']
	);
});

test('変更が無ければそう言う', () => {
	assert.ok(formatSummary([]).includes('変更はありません'));
});

test('要約には export の増減が先に出て、推測しない断りが入る', () => {
	const out = formatSummary(summarizeDiff(DIFF));
	assert.ok(out.includes('## 外から見える変化（export）'), out);
	assert.ok(out.includes('足した `function added`'), out);
	assert.ok(out.includes('消した `function gone`'), out);
	// 消した export は呼び出し元が残る事故につながるので、必ず注意を添える
	assert.ok(out.includes('呼び出し元が残っていないか'), out);
	// 「意図は機械には分からない」と断る（要約を過信させない）
	assert.ok(out.includes('意図までは機械には分からない'), out);
	assert.ok(out.includes('1 ファイル・+2 −1'), out);
});
