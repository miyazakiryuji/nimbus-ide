/**
 * テスト結果からの失敗の取り出し。
 *
 * ここで固めたいのは 2 つ。
 *   - スイートとテストが二重に並ばないこと（いちばん深いところだけを報告する）
 *   - 行番号を 1 起点に戻して出すこと（エディタと Read の数え方に合わせる）
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildTestFailurePrompt,
	collectFailures,
	isFailedState,
	testFailureHeadline,
	type TestResultNode
} from '../core/testFailures';

function node(partial: Partial<TestResultNode> & { label: string }): TestResultNode {
	return { failed: false, messages: [], children: [], ...partial };
}

const tree: TestResultNode[] = [
	node({
		label: 'session',
		failed: true,
		children: [
			node({
				label: 'イベントを正規化する',
				failed: true,
				file: '/repo/src/a.test.ts',
				line: 11,
				messages: ['expected 1 to be 2']
			}),
			node({ label: '通る方', failed: false })
		]
	}),
	node({ label: '単独で落ちたもの', failed: true, messages: ['boom'] })
];

test('Failed と Errored だけを失敗として扱う', () => {
	assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(isFailedState), [false, false, false, true, false, true]);
});

test('失敗した末端だけを、親から辿った名前で集める', () => {
	assert.deepStrictEqual(collectFailures(tree, 10), {
		total: 2,
		failures: [
			{
				name: 'session › イベントを正規化する',
				file: '/repo/src/a.test.ts',
				line: 11,
				messages: ['expected 1 to be 2']
			},
			{ name: '単独で落ちたもの', file: undefined, line: undefined, messages: ['boom'] }
		]
	});
});

test('上限を超えた分は落とすが、総数は残す', () => {
	assert.deepStrictEqual(
		collectFailures(tree, 1).failures.map((failure) => failure.name),
		['session › イベントを正規化する']
	);
	assert.strictEqual(collectFailures(tree, 1).total, 2);
});

test('投入する文は名前・場所・メッセージを含み、行は 1 起点に戻す', () => {
	const { failures, total } = collectFailures(tree, 1);
	assert.strictEqual(
		buildTestFailurePrompt(failures, total),
		[
			'テストが 2 件失敗しました。',
			'',
			'1. session › イベントを正規化する',
			'   /repo/src/a.test.ts:12',
			'````',
			'expected 1 to be 2',
			'````',
			'',
			'…他 1 件は省略しました。',
			'',
			'原因を調べて直してください。まず何が起きているかを説明してから、修正に入ってください。'
		].join('\n')
	);
});

test('失敗が無ければ何も組み立てない', () => {
	assert.strictEqual(buildTestFailurePrompt([], 0), '');
	assert.deepStrictEqual(collectFailures([node({ label: '通る方' })], 10), { failures: [], total: 0 });
});

test('長いメッセージは切り、1 件あたり 3 つまでにする', () => {
	const noisy = [
		node({ label: 'x', failed: true, messages: ['a'.repeat(2000), 'b', 'c', 'd', '  '] })
	];
	const { failures } = collectFailures(noisy, 10);
	assert.deepStrictEqual(
		[failures[0].messages.length, failures[0].messages[0].endsWith('…（省略）')],
		[3, true]
	);
});

test('見出しは件数を言う', () => {
	assert.strictEqual(testFailureHeadline(3), 'テストが 3 件失敗しました');
});
