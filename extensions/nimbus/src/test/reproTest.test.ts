/**
 * 再現手順の生成（T-143）の単体テスト。
 *
 * この機能の芯は「**通る形では作らない**」こと。通るテストを置いてしまうと、
 * 再現できていないことに気づけないまま「直した」ことになる。そこを固定する。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildReproTest, detectFramework, formatReport, parseErrorReport, reproTestPath } from '../core/reproTest';

const NODE_LOG = [
	"TypeError: Cannot read properties of undefined (reading 'name')",
	'    at formatUser (/repo/src/user.ts:42:18)',
	'    at /repo/node_modules/express/lib/router.js:10:5',
	'    at process (node:internal/process:12:1)'
].join('\n');

test('テストの書き方をプロジェクトから決める', () => {
	assert.deepStrictEqual(
		[
			detectFramework(['pubspec.yaml'], ''),
			detectFramework(['package.json'], '{"devDependencies":{"vitest":"^1"}}'),
			detectFramework(['package.json'], '{"devDependencies":{"jest":"^29"}}'),
			detectFramework(['package.json'], '{}'),
			detectFramework([], '')
		],
		['dart', 'vitest', 'jest', 'node', undefined]
	);
});

test('ログから種類・メッセージ・自分のコードの場所を読む', () => {
	const report = parseErrorReport(NODE_LOG);
	assert.strictEqual(report?.type, 'TypeError');
	assert.strictEqual(report?.message, "Cannot read properties of undefined (reading 'name')");
	// node_modules と node:internal は自分のコードではない
	assert.deepStrictEqual([report?.origin?.file, report?.origin?.line], ['/repo/src/user.ts', 42]);
});

test('種類が読めないログでも、本文とスタックがあれば読む', () => {
	const report = parseErrorReport('なにかが壊れました\n    at doThing (/repo/src/a.ts:3:1)');
	assert.strictEqual(report?.type, undefined);
	assert.strictEqual(report?.message, 'なにかが壊れました');
	assert.strictEqual(report?.origin?.file, '/repo/src/a.ts');
});

test('中身が無ければ undefined（空のログで雛形を作らない）', () => {
	assert.strictEqual(parseErrorReport(''), undefined);
	assert.strictEqual(parseErrorReport('   \n  \n'), undefined);
});

test('テストの置き場所は、落ちた場所の隣にする', () => {
	const report = parseErrorReport(NODE_LOG)!;
	assert.strictEqual(reproTestPath(report.origin, 'node'), '/repo/src/user.repro.test.ts');
	assert.strictEqual(reproTestPath(undefined, 'node'), undefined);
});

test('雛形は「いまは落ちる」形で作る（通る形では作らない）', () => {
	const report = parseErrorReport(NODE_LOG)!;
	const out = buildReproTest(report, 'node');
	// 落ちることが目的だと明記する
	assert.ok(out.includes('**このテストは、いまは落ちます。**'), out);
	// 埋める場所を隠さない
	assert.ok(out.includes('TODO: 落ちたときの呼び出しを書く'), out);
	assert.ok(out.includes('再現の入力がまだ書かれていません'), out);
	// どこで何が起きたかを雛形に残す
	assert.ok(out.includes('/repo/src/user.ts:42'), out);
});

test('vitest / jest では expect を使い、node では assert を使う', () => {
	const report = parseErrorReport(NODE_LOG)!;
	assert.ok(buildReproTest(report, 'vitest').includes("import { expect, test } from 'vitest';"));
	assert.ok(buildReproTest(report, 'vitest').includes('expect(String(error)).toContain('));
	assert.ok(buildReproTest(report, 'node').includes('assert.match(String(error)'));
	// jest は import が要らない
	assert.ok(!buildReproTest(report, 'jest').includes("from 'vitest'"));
});

test('正規表現や引用符に入れても壊れないようにする', () => {
	const report = parseErrorReport("Error: it's (broken) [a.b]\n    at f (/repo/src/a.ts:1:1)")!;
	const node = buildReproTest(report, 'node');
	const vitest = buildReproTest(report, 'vitest');
	// 正規表現の記号がエスケープされている
	assert.ok(node.includes('\\(broken\\)'), node);
	// 引用符がエスケープされている
	assert.ok(vitest.includes("it\\'s"), vitest);
});

test('Dart では fail() で落とす', () => {
	const report = parseErrorReport("Exception: だめ\n    at f (/repo/lib/a.dart:1:1)")!;
	const out = buildReproTest(report, 'dart');
	assert.ok(out.includes("import 'package:test/test.dart';"), out);
	assert.ok(out.includes('fail('), out);
});

test('まとめは「再現を先に」と、推測しないことを求める', () => {
	const out = formatReport(parseErrorReport(NODE_LOG)!);
	assert.ok(out.includes('**再現するテストを先に書いてください。**'), out);
	assert.ok(out.includes('推測せず、**分からないと書く**'), out);
	assert.ok(out.includes('/repo/src/user.ts:42'), out);
});

test('自分のコードが見つからないときは、そう言う', () => {
	const out = formatReport(parseErrorReport('Error: x\n    at y (/repo/node_modules/dep/index.js:1:1)')!);
	assert.ok(out.includes('自分のコードの行が見つかりませんでした'), out);
});
