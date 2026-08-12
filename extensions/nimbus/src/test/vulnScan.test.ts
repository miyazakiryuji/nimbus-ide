/**
 * 危ない書き方（T-202）の単体テスト。
 *
 * **断定しないこと**と、**当てられても困らない用途を拾わないこと**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { isExampleFile, renderVulnFindings, scanSource } from '../core/vulnScan';

const rules = (source: string): string[] => scanSource('a.ts', source).map((f) => f.rule);

test('証明書の検証を切っているのを拾う', () => {
	assert.deepStrictEqual(rules('const agent = new Agent({ rejectUnauthorized: false });'), ['tls-disabled']);
});

test('シェルに組み立てた文字列を渡しているのを拾う', () => {
	assert.deepStrictEqual(rules('exec(`git checkout ${branch}`);'), ['shell-injection']);
});

test('文字列を繋いだ SQL を拾う', () => {
	assert.deepStrictEqual(rules('const sql = "SELECT * FROM users WHERE id = " + id;'), ['sql-concat']);
});

test('壊れたハッシュを拾う', () => {
	assert.deepStrictEqual(rules("createHash('md5').update(x)"), ['weak-hash']);
});

test('チェックサム用途の md5 は拾わない（安全性を求めていない）', () => {
	assert.deepStrictEqual(rules("const checksum = createHash('md5').update(x)"), []);
});

test('Math.random を拾うが、揺らぎ用途は拾わない', () => {
	assert.deepStrictEqual(
		[rules('const token = Math.random();'), rules('const jitter = Math.random() * 100;')],
		[['insecure-random'], []]
	);
});

test('eval と new Function を拾う', () => {
	assert.deepStrictEqual(rules('eval(userInput);\nconst f = new Function("x", "return x");'), ['eval', 'eval']);
});

test('http:// を拾うが、localhost は拾わない', () => {
	assert.deepStrictEqual(
		[rules("fetch('http://example.com')"), rules("fetch('http://localhost:3000')")],
		[['http-url'], []]
	);
});

test('コメント行は見ない', () => {
	assert.deepStrictEqual(rules('// eval(x) は危ない'), []);
});

test('テストや例のファイルを見分ける', () => {
	assert.deepStrictEqual(
		['src/test/a.ts', 'examples/b.ts', 'src/a.test.ts', 'src/a.ts'].map(isExampleFile),
		[true, true, true, false]
	);
});

test('断定せず、代わりに何をするかを書く', () => {
	const text = renderVulnFindings(scanSource('a.ts', 'eval(x);'));
	assert.deepStrictEqual(
		['実際に危ないかは文脈によります', '実行しない形にする'].map((s) => text.includes(s)),
		[true, true]
	);
});
