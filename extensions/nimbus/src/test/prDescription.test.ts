/**
 * PR の説明文（T-220）の単体テスト。
 *
 * 機械が埋められないところ（何のための変更か）を**捏造しないこと**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { renderPrDescription, suggestTitle } from '../core/prDescription';
import { groupCommits, parseCommitLog } from '../core/releaseNotes';
import { parseNumstat, summarize } from '../core/changeStats';

const changes = groupCommits(
	parseCommitLog(['aaa\tNimbus: 何かを足す（T-101）', 'bbb\tfix: 落ちるのを直す（T-102）'].join('\n'))
);
const stats = summarize(parseNumstat(['20\t2\tsrc/a.ts', '5\t0\tsrc/test/a.test.ts'].join('\n')));

test('コミットが 1 つならその件名を題にする', () => {
	assert.strictEqual(suggestTitle(groupCommits(parseCommitLog('aaa\tひとつだけ'))), 'ひとつだけ');
});

test('複数ならタスク ID をまとめる', () => {
	assert.strictEqual(suggestTitle(changes), 'T-101 / T-102 をまとめて');
});

test('決められないときは空にする（それらしい題を捏造しない）', () => {
	assert.strictEqual(suggestTitle(groupCommits(parseCommitLog(['aaa\t片付け', 'bbb\t整理'].join('\n')))), '');
});

test('「何のための変更か」は人に書かせる（機械では埋めない）', () => {
	const text = renderPrDescription({ branch: 'nimbus/x', base: 'nimbus', changes, stats });
	assert.deepStrictEqual(
		['## 何のための変更か', 'ここだけは機械では埋められません'].map((s) => text.includes(s)),
		[true, true]
	);
});

test('入っているものを分類して並べ、見るべきファイルを大きい順に出す', () => {
	const text = renderPrDescription({ branch: 'nimbus/x', base: 'nimbus', changes, stats });
	assert.deepStrictEqual(
		['**足したもの**', '**直したもの**', '`src/a.ts` +20 / -2', '〈テスト〉'].map((s) => text.includes(s)),
		[true, true, true, true]
	);
});

test('テストが伴っていなければ、説明文の中で警告する', () => {
	const noTests = summarize(parseNumstat('20\t2\tsrc/a.ts'));
	const text = renderPrDescription({ branch: 'nimbus/x', base: 'nimbus', changes, stats: noTests });
	assert.ok(text.includes('テストが伴っていません'));
});

test('テストの結果が分かるときは、確かめたことに入れる', () => {
	const text = renderPrDescription({
		branch: 'nimbus/x',
		base: 'nimbus',
		changes,
		stats,
		testSummary: '単体テスト 452 件すべて通過'
	});
	assert.ok(text.includes('- 単体テスト 452 件すべて通過'));
});
