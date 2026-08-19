/**
 * スナップショットの更新レビュー。
 *
 * 要件は 2 つ。**何が変わったかを名指しすること**と、
 * 画像のように中身を読めないものを「読めたつもり」にさせないこと。
 *
 * 守っている修正（T-274）: T-181
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildSnapshotPrompt,
	changedSnapshotKeys,
	describeSnapshotChanges,
	isBinarySnapshot,
	isSnapshotPath,
	parseNameStatus,
	type SnapshotChange
} from '../core/snapshotReview';

test('スナップショットとして扱うパスを見分ける', () => {
	assert.deepStrictEqual(
		[
			'src/__snapshots__/a.test.ts.snap',
			'test/goldens/home.png',
			'test/home_golden.png',
			'spec/x.approved.txt',
			'src/a.ts',
			'docs/golden-rules.md'
		].map(isSnapshotPath),
		[true, true, true, true, false, false]
	);
});

test('画像は中身を比較できないものとして扱う', () => {
	assert.deepStrictEqual(
		['a.png', 'b.snap', 'c.JPEG'].map(isBinarySnapshot),
		[true, false, true]
	);
});

test('git diff --name-status を読む（改名は更新扱い）', () => {
	assert.deepStrictEqual(
		parseNameStatus('M\tsrc/a.snap\nA\tsrc/b.snap\nD\tsrc/c.snap\nR100\told.snap\tnew.snap\n壊れた行'),
		[
			{ status: 'modified', path: 'src/a.snap' },
			{ status: 'added', path: 'src/b.snap' },
			{ status: 'deleted', path: 'src/c.snap' },
			{ status: 'modified', path: 'new.snap' }
		]
	);
});

test('変わったスナップショットの名前を差分から拾う', () => {
	const diff = [
		'@@ -1,2 +1,2 @@',
		'-exports[`renders header 1`] = `old`;',
		'+exports[`renders header 1`] = `new`;',
		'+exports[`renders footer 1`] = `x`;',
		' 関係ない行'
	].join('\n');
	assert.deepStrictEqual(changedSnapshotKeys(diff), ['renders header 1', 'renders footer 1']);
});

const CHANGES: SnapshotChange[] = [
	{ path: 'src/__snapshots__/a.snap', status: 'modified', binary: false, keys: ['renders header 1'] },
	{ path: 'test/goldens/home.png', status: 'added', binary: true, keys: [] }
];

test('一覧は名前を出し、画像は読めないと明示する', () => {
	assert.strictEqual(
		describeSnapshotChanges(CHANGES, (path) => path),
		[
			'スナップショットが 2 件変わっています',
			'- 更新 src/__snapshots__/a.snap: renders header 1',
			'- 追加 test/goldens/home.png（画像のため中身は比較できません）'
		].join('\n')
	);
	assert.strictEqual(describeSnapshotChanges([], (path) => path), 'スナップショットの更新はありません。');
});

test('投入する文は「直して」ではなく「説明して」から始める', () => {
	const prompt = buildSnapshotPrompt(CHANGES, (path) => path);
	assert.ok(prompt.includes('**なぜその出力になったのか**を説明してください。'), prompt);
	assert.ok(prompt.includes('- 更新 src/__snapshots__/a.snap: renders header 1'), prompt);
	assert.ok(!prompt.includes('スナップショットが 2 件変わっています'), prompt);
	assert.strictEqual(buildSnapshotPrompt([], (path) => path), '');
});
