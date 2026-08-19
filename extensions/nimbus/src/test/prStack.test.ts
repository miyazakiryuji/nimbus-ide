/**
 * 積み上げた PR。
 *
 * 守りたいのは 2 つ — **入れる順は下から**であることと、
 * **下が入った後の付け替え**（いちばん忘れる作業）が出ること。
 *
 * 守っている修正（T-274）: T-135
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	afterMerge,
	below,
	buildStacks,
	describeStacks,
	mergeOrder,
	orphans,
	parsePrList,
	renderRestackCommands
} from '../core/prStack';

const JSON_LIST = JSON.stringify([
	{ number: 12, title: '土台を足す', headRefName: 'feat/base', baseRefName: 'main', isDraft: false },
	{ number: 13, title: 'API を足す', headRefName: 'feat/api', baseRefName: 'feat/base', isDraft: false },
	{ number: 14, title: '画面を足す', headRefName: 'feat/ui', baseRefName: 'feat/api', isDraft: true },
	{ number: 15, title: '別件', headRefName: 'fix/typo', baseRefName: 'main', isDraft: false }
]);

const PRS = parsePrList(JSON_LIST);

test('gh の JSON を読む。壊れていたら空で返す', () => {
	assert.deepStrictEqual(PRS[2], {
		number: 14,
		title: '画面を足す',
		head: 'feat/ui',
		base: 'feat/api',
		isDraft: true
	});
	assert.deepStrictEqual(parsePrList('壊れた JSON'), []);
	assert.deepStrictEqual(parsePrList('{}'), []);
});

const STACKS = buildStacks(PRS, 'main');

test('幹から積み上がった順に組む', () => {
	assert.deepStrictEqual(
		STACKS.map((node) => [node.pr.number, node.above.map((child) => child.pr.number)]),
		[
			[12, [13]],
			[15, []]
		]
	);
});

test('入れる順は下から', () => {
	assert.deepStrictEqual(
		mergeOrder(STACKS).map((pr) => pr.number),
		[12, 13, 14, 15]
	);
	assert.deepStrictEqual(
		below(STACKS, 14).map((pr) => pr.number),
		[12, 13]
	);
	assert.deepStrictEqual(below(STACKS, 12), []);
});

test('輪になっている PR は積まず、迷子として返す', () => {
	const cyclic = parsePrList(
		JSON.stringify([
			{ number: 20, headRefName: 'a', baseRefName: 'b' },
			{ number: 21, headRefName: 'b', baseRefName: 'a' }
		])
	);
	const stacks = buildStacks(cyclic, 'main');
	assert.deepStrictEqual(stacks, []);
	assert.deepStrictEqual(
		orphans(cyclic, stacks).map((pr) => pr.number),
		[20, 21]
	);
});

test('下が入ったら、直上の PR を幹へ向け直す', () => {
	const restacks = afterMerge(PRS, 'feat/base', 'main');
	assert.deepStrictEqual(restacks, [{ number: 13, head: 'feat/api', from: 'feat/base', to: 'main' }]);

	const script = renderRestackCommands(restacks);
	assert.ok(script.includes('git rebase --onto origin/main origin/feat/base'), script);
	assert.ok(script.includes('git push --force-with-lease origin feat/api'), script);
	assert.ok(script.includes('gh pr edit 13 --base main'), script);
	assert.strictEqual(renderRestackCommands([]), '');
});

test('木と入れる順を一緒に見せる', () => {
	assert.strictEqual(
		describeStacks(STACKS, 'main'),
		[
			'main',
			'├─ #12 土台を足す',
			'  └─ #13 API を足す',
			'    └─ #14 画面を足す（下書き）',
			'└─ #15 別件',
			'',
			'入れる順: #12 → #13 → #14 → #15'
		].join('\n')
	);
	assert.strictEqual(describeStacks([], 'main'), '積み上げた PR はありません。');
});
