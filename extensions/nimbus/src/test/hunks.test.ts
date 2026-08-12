/**
 * hunk 単位の部分採用（T-113）の単体テスト。
 *
 * ここを誤ると**ファイルに書かれる内容そのものが変わる**ので、
 * 「選んだものだけが適用され、選ばなかったものは元のまま残る」を軸に押さえる。
 * 往復（全部選ぶ＝提案どおり／何も選ばない＝元のまま）は不変条件として毎回確かめる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { applyHunks, describeHunk, diffHunks, previewHunk } from '../core/hunks';
import { planPartialEdit } from '../core/partialEdit';

const all = (n: number): Set<number> => new Set(Array.from({ length: n }, (_, i) => i));
const none = new Set<number>();

/** 差分 → 適用の往復。どんな入力でも成り立つべき 2 つの不変条件 */
function assertRoundTrip(before: string, after: string): void {
	const hunks = diffHunks(before, after);
	assert.strictEqual(applyHunks(before, hunks, all(hunks.length)), after, '全部選んだら提案どおりになる');
	assert.strictEqual(applyHunks(before, hunks, none), before, '何も選ばなければ元のまま');
}

test('変更が無ければ hunk は 0 個', () => {
	assert.deepStrictEqual(diffHunks('a\nb\nc', 'a\nb\nc'), []);
});

test('離れた 2 か所の変更は、2 つの hunk に分かれる', () => {
	const before = 'a\nb\nc\nd\ne';
	const after = 'a\nB\nc\nd\nE';
	const hunks = diffHunks(before, after);
	assert.deepStrictEqual(
		hunks.map((h) => [h.beforeStart, h.beforeLines, h.afterLines]),
		[
			[1, ['b'], ['B']],
			[4, ['e'], ['E']]
		]
	);
	assertRoundTrip(before, after);
});

test('片方だけ採用すると、選ばなかったほうは元のまま残る', () => {
	const before = 'a\nb\nc\nd\ne';
	const after = 'a\nB\nc\nd\nE';
	const hunks = diffHunks(before, after);
	assert.deepStrictEqual(
		[applyHunks(before, hunks, new Set([0])), applyHunks(before, hunks, new Set([1]))],
		['a\nB\nc\nd\ne', 'a\nb\nc\nd\nE']
	);
});

test('追加だけ・削除だけも扱える', () => {
	assert.deepStrictEqual(
		diffHunks('a\nc', 'a\nb\nc').map((h) => [h.beforeStart, h.beforeLines, h.afterLines]),
		[[1, [], ['b']]]
	);
	assert.deepStrictEqual(
		diffHunks('a\nb\nc', 'a\nc').map((h) => [h.beforeStart, h.beforeLines, h.afterLines]),
		[[1, ['b'], []]]
	);
	assertRoundTrip('a\nc', 'a\nb\nc');
	assertRoundTrip('a\nb\nc', 'a\nc');
});

test('空のファイルへの書き込みと、全消しも往復する', () => {
	assertRoundTrip('', 'a\nb\n');
	assertRoundTrip('a\nb\n', '');
	assertRoundTrip('', '');
});

test('末尾の改行の有無は保たれる（勝手に足さない・削らない）', () => {
	assertRoundTrip('a\nb', 'a\nb\n');
	assertRoundTrip('a\nb\n', 'a\nb');
	const hunks = diffHunks('a\nb', 'a\nb\n');
	assert.strictEqual(applyHunks('a\nb', hunks, all(hunks.length)), 'a\nb\n');
});

test('CRLF の行末も壊さない', () => {
	assertRoundTrip('a\r\nb\r\n', 'a\r\nB\r\n');
});

test('選択肢の見出しは、何行目で何が起きるかを言う', () => {
	assert.deepStrictEqual(
		[
			describeHunk({ beforeStart: 0, beforeLines: [], afterLines: ['x'] }),
			describeHunk({ beforeStart: 4, beforeLines: ['x', 'y'], afterLines: [] }),
			describeHunk({ beforeStart: 2, beforeLines: ['x'], afterLines: ['y', 'z'] })
		],
		['1 行目に 1 行を追加', '5 行目から 2 行を削除', '3 行目から 1 行を 2 行に置き換え']
	);
});

test('プレビューは長すぎる hunk を打ち切り、打ち切ったことを言う', () => {
	const long = previewHunk({ beforeStart: 0, beforeLines: ['1', '2', '3', '4'], afterLines: ['5', '6', '7', '8'] });
	assert.strictEqual(long, '- 1 ⏎ - 2 ⏎ - 3 ⏎ - 4 ⏎ + 5 ⏎ + 6 …（他 2 行）');
	assert.strictEqual(previewHunk({ beforeStart: 0, beforeLines: ['a'], afterLines: ['b'] }), '- a ⏎ + b');
});

test('Write は「いまのファイル」と提案された全文の差分で割る', () => {
	const plan = planPartialEdit('Write', { file_path: '/x/a.ts', content: 'a\nB\nc\nd\nE' }, () => 'a\nb\nc\nd\ne');
	assert.deepStrictEqual(plan?.parts.map((p) => p.label), ['2 行目から 1 行を 1 行に置き換え', '5 行目から 1 行を 1 行に置き換え']);
	assert.deepStrictEqual(plan?.rebuild(new Set([0])), { file_path: '/x/a.ts', content: 'a\nB\nc\nd\ne' });
});

test('Edit は new_string だけを組み直す（old_string は置き換え対象なので触らない）', () => {
	const plan = planPartialEdit('Edit', { file_path: '/x/a.ts', old_string: 'a\nb\nc\nd\ne', new_string: 'a\nB\nc\nd\nE' }, () => undefined);
	assert.deepStrictEqual(plan?.rebuild(new Set([1])), {
		file_path: '/x/a.ts',
		old_string: 'a\nb\nc\nd\ne',
		new_string: 'a\nb\nc\nd\nE'
	});
});

test('MultiEdit は編集そのものが単位。選ばなかった編集は落ちる', () => {
	const edits = [
		{ old_string: 'a', new_string: 'A' },
		{ old_string: 'b', new_string: 'B' },
		{ old_string: 'c', new_string: 'C' }
	];
	const plan = planPartialEdit('MultiEdit', { file_path: '/x/a.ts', edits }, () => undefined);
	assert.deepStrictEqual(plan?.parts.map((p) => p.label), [
		'1 件目: a → A',
		'2 件目: b → B',
		'3 件目: c → C'
	]);
	assert.deepStrictEqual(plan?.rebuild(new Set([0, 2])), {
		file_path: '/x/a.ts',
		edits: [
			{ old_string: 'a', new_string: 'A' },
			{ old_string: 'c', new_string: 'C' }
		]
	});
});

test('選べる部分が 1 つしかないなら「一部だけ採用」は出さない（許可と同じなので）', () => {
	assert.deepStrictEqual(
		[
			// 新規ファイル＝全体が 1 かたまり
			planPartialEdit('Write', { file_path: '/x/a.ts', content: 'a\nb' }, () => undefined),
			// 変更が 1 か所だけ
			planPartialEdit('Write', { file_path: '/x/a.ts', content: 'a\nB\nc' }, () => 'a\nb\nc'),
			// 編集が 1 件だけの MultiEdit
			planPartialEdit('MultiEdit', { file_path: '/x/a.ts', edits: [{ old_string: 'a', new_string: 'A' }] }, () => undefined)
		],
		[undefined, undefined, undefined]
	);
});

test('部分採用の対象にならないものは undefined（書き換え系以外・引数が欠けている）', () => {
	assert.deepStrictEqual(
		[
			planPartialEdit('Bash', { command: 'ls' }, () => undefined),
			planPartialEdit('Write', { file_path: '/x/a.ts' }, () => 'a'),
			planPartialEdit('Edit', { file_path: '/x/a.ts', old_string: 'a' }, () => undefined),
			planPartialEdit('MultiEdit', { file_path: '/x/a.ts', edits: [] }, () => undefined),
			planPartialEdit('MultiEdit', { file_path: '/x/a.ts', edits: ['not an object'] }, () => undefined),
			planPartialEdit('Write', 'not an object', () => undefined)
		],
		[undefined, undefined, undefined, undefined, undefined, undefined]
	);
});

test('提案どおりの内容なら hunk は 0 個（差分が無いのに選ばせない）', () => {
	assert.strictEqual(planPartialEdit('Write', { file_path: '/x/a.ts', content: 'a\nb' }, () => 'a\nb'), undefined);
});

test('大きすぎる差分は 1 かたまりに落とす（固まらせない）', () => {
	// LCS の上限を超える大きさ。部分採用はできないが、計算が終わることが大事
	const before = Array.from({ length: 2200 }, (_, i) => `before ${i}`).join('\n');
	const after = Array.from({ length: 2200 }, (_, i) => `after ${i}`).join('\n');
	const hunks = diffHunks(before, after);
	assert.strictEqual(hunks.length, 1);
	assertRoundTrip(before, after);
});
