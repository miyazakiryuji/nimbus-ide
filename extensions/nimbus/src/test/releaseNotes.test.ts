/**
 * リリースノートの下書き（T-062）の単体テスト。
 *
 * 事実を落とさないことが第一。分類は当てにいかず、迷ったら「その他」に落ちることを確かめる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { classifyCommit, groupCommits, parseCommitLog, renderReleaseNotes, taskIdsIn } from '../core/releaseNotes';

const log = [
	'abc1234\tNimbus: スタックトレースから該当箇所を開く（T-105）',
	'def5678\tdocs: 仕様を書き起こす',
	'ghi9012\tNimbus: nls.ts の破損を直す',
	'jkl3456\tchore: 依存を上げる',
	'',
	'壊れた行'
].join('\n');

test('git log の出力からハッシュと件名を読む（壊れた行は飛ばす）', () => {
	assert.deepStrictEqual(
		parseCommitLog(log).map((c) => c.hash),
		['abc1234', 'def5678', 'ghi9012', 'jkl3456']
	);
});

test('件名からタスク ID を拾う（重複は 1 度だけ）', () => {
	assert.deepStrictEqual(taskIdsIn('T-105 と T-119 と T-105 を直す'), ['T-105', 'T-119']);
});

test('接頭辞と動詞で分類し、迷ったら「その他」に落とす', () => {
	assert.deepStrictEqual(
		[
			classifyCommit('docs: 仕様を書く'),
			classifyCommit('fix: 落ちるのを直す'),
			classifyCommit('Nimbus: スタックトレースから開けるようにする'),
			classifyCommit('chore: 依存を上げる')
		],
		['docs', 'fix', 'feature', 'other']
	);
});

test('Markdown に分類ごとに並び、件名がそのまま載る', () => {
	const text = renderReleaseNotes(groupCommits(parseCommitLog(log)), 'v0.6.0', 'HEAD');
	assert.deepStrictEqual(
		[
			text.includes('## 足したもの'),
			text.includes('Nimbus: スタックトレースから該当箇所を開く（T-105） `abc1234`'),
			text.includes('## ドキュメント'),
			text.includes('コミット数: **4**')
		],
		[true, true, true, true]
	);
});

test('件名に無い ID だけを添える（二重に出さない）', () => {
	const text = renderReleaseNotes(groupCommits([{ hash: 'aaa', subject: 'fix: T-999 を直す' }, { hash: 'bbb', subject: 'fix: 落ちるのを直す' }]), 'a', 'b');
	assert.deepStrictEqual([text.includes('fix: T-999 を直す `aaa`'), text.includes('（T-999）')], [true, false]);
});

test('範囲にコミットが無ければ、その旨だけを書く', () => {
	assert.ok(renderReleaseNotes([], 'v0.6.0', 'HEAD').includes('この範囲にコミットがありません'));
});
