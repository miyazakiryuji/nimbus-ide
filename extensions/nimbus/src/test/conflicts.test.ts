/**
 * コンフリクト解消支援（T-115）の単体テスト。
 *
 * ここを誤ると**変更が消える**ので、「選ばなかったものが残ること」を軸に押さえる。
 * 壊れたマーカー（閉じていない）を勝手に解釈しないことも、同じ理由で重要。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	conflictPrompt,
	describeConflict,
	hasConflictMarkers,
	looksAdditive,
	parseConflicts,
	resolveConflicts,
	type Resolution
} from '../core/conflicts';

const SIMPLE = ['before', '<<<<<<< HEAD', 'ours 1', 'ours 2', '=======', 'theirs 1', '>>>>>>> feature', 'after'].join('\n');

const DIFF3 = [
	'<<<<<<< HEAD',
	'ours',
	'||||||| merged common ancestors',
	'base',
	'=======',
	'theirs',
	'>>>>>>> other'
].join('\n');

const TWO = [
	'<<<<<<< HEAD',
	'A1',
	'=======',
	'B1',
	'>>>>>>> x',
	'middle',
	'<<<<<<< HEAD',
	'A2',
	'=======',
	'B2',
	'>>>>>>> x'
].join('\n');

const choose = (pairs: [number, Resolution][]): Map<number, Resolution> => new Map(pairs);

test('マーカーの有無を見分ける', () => {
	assert.deepStrictEqual([hasConflictMarkers(SIMPLE), hasConflictMarkers('ふつうの文\n')], [true, false]);
});

test('両側の中身とラベルを読む', () => {
	const [block] = parseConflicts(SIMPLE);
	assert.deepStrictEqual(
		[block.start, block.length, block.ours.label, block.ours.lines, block.theirs.label, block.theirs.lines],
		[1, 6, 'HEAD', ['ours 1', 'ours 2'], 'feature', ['theirs 1']]
	);
});

test('diff3 形式では分岐元も読む', () => {
	const [block] = parseConflicts(DIFF3);
	assert.deepStrictEqual(
		[block.ours.lines, block.base?.lines, block.theirs.lines],
		[['ours'], ['base'], ['theirs']]
	);
});

test('分岐元が無い形式では base を持たない', () => {
	assert.strictEqual(parseConflicts(SIMPLE)[0].base, undefined);
});

test('閉じていないマーカーは採らない（壊れたファイルを解釈しない）', () => {
	const broken = '<<<<<<< HEAD\nours\n=======\ntheirs\n';
	assert.deepStrictEqual(parseConflicts(broken), []);
	// 解決しようとしても、元のまま返す（消さない）
	assert.strictEqual(resolveConflicts(broken, choose([[0, 'ours']])), broken);
});

test('採りかたのとおりに書き戻す', () => {
	assert.deepStrictEqual(
		[
			resolveConflicts(SIMPLE, choose([[0, 'ours']])),
			resolveConflicts(SIMPLE, choose([[0, 'theirs']])),
			resolveConflicts(SIMPLE, choose([[0, 'both']]))
		],
		[
			'before\nours 1\nours 2\nafter',
			'before\ntheirs 1\nafter',
			'before\nours 1\nours 2\ntheirs 1\nafter'
		]
	);
});

test('diff3 では分岐元に戻すこともできる', () => {
	assert.strictEqual(resolveConflicts(DIFF3, choose([[0, 'base']])), 'base');
});

test('選ばなかった競合はマーカーごと残す（黙って片方を採らない）', () => {
	const out = resolveConflicts(TWO, choose([[0, 'both']]));
	assert.deepStrictEqual(out.split('\n'), [
		'A1',
		'B1',
		'middle',
		'<<<<<<< HEAD',
		'A2',
		'=======',
		'B2',
		'>>>>>>> x'
	]);
});

test('複数の競合をそれぞれ別に解決できる', () => {
	assert.strictEqual(
		resolveConflicts(TWO, choose([[0, 'ours'], [1, 'theirs']])),
		'A1\nmiddle\nB2'
	);
});

test('競合が無いテキストはそのまま返す', () => {
	assert.strictEqual(resolveConflicts('a\nb\n', choose([[0, 'ours']])), 'a\nb\n');
});

test('片側が空なら追記どうしとは見なさない（消したのか足したのか分からない）', () => {
	const [empty] = parseConflicts(['<<<<<<< a', '=======', 'x', '>>>>>>> b'].join('\n'));
	assert.strictEqual(looksAdditive(empty), false);
});

test('共通の行が無ければ追記どうしの目安になる', () => {
	const [additive] = parseConflicts(['<<<<<<< a', '- T-1 を足す', '=======', '- T-2 を足す', '>>>>>>> b'].join('\n'));
	const [overlapping] = parseConflicts(['<<<<<<< a', 'same', 'x', '=======', 'same', 'y', '>>>>>>> b'].join('\n'));
	assert.deepStrictEqual([looksAdditive(additive), looksAdditive(overlapping)], [true, false]);
});

test('説明は行番号と両側の行数を出す', () => {
	assert.strictEqual(describeConflict(parseConflicts(SIMPLE)[0], 0), '1 件目（2 行目）: こちら 2 行 ⇔ むこう 1 行');
});

test('相談文には両側がそのまま入り、意図を残すよう頼む', () => {
	const prompt = conflictPrompt('tasks.md', parseConflicts(SIMPLE));
	assert.ok(prompt.includes('tasks.md で 1 件のコンフリクト'), prompt);
	assert.ok(prompt.includes('両方の変更の意図を汲んだ解決案'), prompt);
	assert.ok(prompt.includes('ours 1') && prompt.includes('theirs 1'), prompt);
	assert.ok(prompt.includes('こちら（HEAD）') && prompt.includes('むこう（feature）'), prompt);
});
