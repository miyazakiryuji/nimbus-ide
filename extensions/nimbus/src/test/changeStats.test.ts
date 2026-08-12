/**
 * 変更のようす（T-159 / T-082）の単体テスト。
 *
 * 誤って「テストが無い」と言うと、言われた側がその指摘を無視するようになる。
 * **ドキュメントだけの変更で騒がないこと**を特に押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { isTestPath, parseNumstat, renderChangeStats, summarize } from '../core/changeStats';

test('numstat を読む（バイナリは 0 として扱う）', () => {
	assert.deepStrictEqual(
		parseNumstat(['12\t3\tsrc/a.ts', '-\t-\timages/logo.png', '壊れた行'].join('\n')).map(
			(f) => `${f.path}:${f.added}:${f.removed}`
		),
		['src/a.ts:12:3', 'images/logo.png:0:0']
	);
});

test('言語ごとの慣習でテストを見分ける', () => {
	assert.deepStrictEqual(
		[
			isTestPath('src/test/a.test.ts'),
			isTestPath('lib/widget_test.dart'),
			isTestPath('pkg/handler_test.go'),
			isTestPath('src/a.ts')
		],
		[true, true, true, false]
	);
});

test('行数とファイル数を数え、変更の大きい順に並べる', () => {
	const stats = summarize(parseNumstat(['1\t1\tsrc/small.ts', '50\t10\tsrc/big.ts'].join('\n')));
	assert.deepStrictEqual(
		{ files: stats.files.map((f) => f.path), added: stats.added, removed: stats.removed },
		{ files: ['src/big.ts', 'src/small.ts'], added: 51, removed: 11 }
	);
});

test('実装だけが変わっていればテスト無しとして指摘する', () => {
	const stats = summarize(parseNumstat('10\t0\tsrc/a.ts'));
	assert.deepStrictEqual({ no: stats.noTestChanges, untested: stats.untested }, { no: true, untested: ['src/a.ts'] });
});

test('テストが一緒に変わっていれば指摘しない', () => {
	const stats = summarize(parseNumstat(['10\t0\tsrc/a.ts', '5\t0\tsrc/test/a.test.ts'].join('\n')));
	assert.strictEqual(stats.noTestChanges, false);
});

test('ドキュメントや設定だけの変更では騒がない', () => {
	const stats = summarize(parseNumstat(['10\t0\tREADME.md', '3\t0\tpackage.json', '2\t0\tdocs/spec.md'].join('\n')));
	assert.deepStrictEqual({ no: stats.noTestChanges, untested: stats.untested }, { no: false, untested: [] });
});

test('変更が無ければ、その旨だけを書く', () => {
	assert.ok(renderChangeStats(summarize([])).includes('変更はありません'));
});

test('指摘には理由を残す場所まで書く', () => {
	const text = renderChangeStats(summarize(parseNumstat('10\t0\tsrc/a.ts')));
	assert.deepStrictEqual(
		['## テストが伴っていません', 'tasks.md', '`src/a.ts`'].map((s) => text.includes(s)),
		[true, true, true]
	);
});
