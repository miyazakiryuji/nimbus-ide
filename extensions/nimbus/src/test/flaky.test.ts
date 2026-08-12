/**
 * flaky テストの検出（T-133）の単体テスト。
 *
 * 「1 回でも結果が変わったら flaky」を外さないことが要。
 * n 回中 1 回だけ落ちたものを「だいたい通っている」と丸めた瞬間に、この機能は無意味になる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { assessStability, formatReport, inconsistentlyPresent, parseTap } from '../core/flaky';

const pass = (name: string) => ({ name, passed: true });
const fail = (name: string) => ({ name, passed: false });

test('TAP から結果を読む（見出しや診断行は拾わない）', () => {
	const tap = [
		'TAP version 13',
		'# Subtest: 拾ってはいけない見出し',
		'ok 1 - 通ったテスト',
		'not ok 2 - 落ちたテスト',
		'  ---',
		'  error: |-',
		'  ...',
		'1..2',
		'# tests 2'
	].join('\n');
	assert.deepStrictEqual(parseTap(tap), [
		{ name: '通ったテスト', passed: true },
		{ name: '落ちたテスト', passed: false }
	]);
});

test('SKIP / TODO の印は名前から外す（同じテストとして数えるため）', () => {
	assert.deepStrictEqual(parseTap('ok 1 - 名前 # SKIP 理由'), [{ name: '名前', passed: true }]);
});

test('1 回でも結果が変われば flaky（n 回中 1 回でも）', () => {
	const verdicts = assessStability([
		[pass('a'), pass('b')],
		[pass('a'), pass('b')],
		[pass('a'), fail('b')]
	]);
	assert.deepStrictEqual(
		verdicts.map((v) => [v.name, v.stability, v.passes, v.failures]),
		[['b', 'flaky', 2, 1], ['a', 'stable-pass', 3, 0]]
	);
});

test('毎回落ちるものは flaky ではなく「落ちている」', () => {
	const verdicts = assessStability([[fail('x')], [fail('x')]]);
	assert.deepStrictEqual(verdicts.map((v) => v.stability), ['stable-fail']);
});

test('並びは 揺れ → 毎回落ちる → 通る。揺れは当たりやすい順', () => {
	const verdicts = assessStability([
		[pass('よく落ちる'), pass('たまに落ちる'), fail('毎回落ちる'), pass('通る')],
		[fail('よく落ちる'), pass('たまに落ちる'), fail('毎回落ちる'), pass('通る')],
		[fail('よく落ちる'), fail('たまに落ちる'), fail('毎回落ちる'), pass('通る')]
	]);
	assert.deepStrictEqual(verdicts.map((v) => v.name), ['よく落ちる', 'たまに落ちる', '毎回落ちる', '通る']);
});

test('回によって現れないテストを別に見つける', () => {
	const verdicts = assessStability([[pass('いつもいる'), pass('ときどきいる')], [pass('いつもいる')]]);
	assert.deepStrictEqual(
		inconsistentlyPresent(verdicts, 2).map((v) => [v.name, v.runs]),
		[['ときどきいる', 1]]
	);
});

test('揺れが無いときも「出なかっただけかもしれない」と断る', () => {
	const out = formatReport(assessStability([[pass('a')], [pass('a')]]), 2);
	assert.ok(out.includes('揺れているテストはありませんでした'), out);
	// 「無い」と言い切ると、回数不足を見落とす
	assert.ok(out.includes('出なかっただけ'), out);
});

test('報告は、放置すると何が起きるかまで書く', () => {
	const out = formatReport(assessStability([[pass('b')], [fail('b')]]), 2);
	assert.ok(out.includes('## 揺れているもの'), out);
	assert.ok(out.includes('`b` — 2 回中 1 回失敗'), out);
	// 直す動機は「赤が信用されなくなる」ことなので、そこを書く
	assert.ok(out.includes('テスト全体が信用されなくなります'), out);
});

test('毎回落ちるものと、現れないものを見出しで分ける', () => {
	const runs = [[fail('ずっと赤'), pass('ときどき')], [fail('ずっと赤')]];
	const out = formatReport(assessStability(runs), 2);
	assert.ok(out.includes('## 毎回落ちているもの'), out);
	assert.ok(out.includes('## 回によって現れないもの'), out);
	assert.ok(out.includes('動的に作られている'), out);
});
