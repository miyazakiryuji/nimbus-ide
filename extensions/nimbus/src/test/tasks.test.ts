/**
 * カンバンの状態機械。
 * 「上限を超えて走らない」「再起動後に走っているふりをしない」は、
 * 間違えるとコストと信頼の両方を損なうので必ず押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	deriveState,
	KANBAN_COLUMNS,
	nextStartable,
	normalizeState,
	occupiesSlot,
	restoreState,
	type KanbanTask
} from '../core/tasks';

function task(partial: Partial<KanbanTask> & { taskId: string }): KanbanTask {
	return {
		title: partial.taskId,
		repoCwd: '/repo',
		worktreePath: `/wt/${partial.taskId}`,
		branch: `nimbus/${partial.taskId}`,
		prompt: 'do it',
		state: 'pending',
		createdAt: 0,
		updatedAt: 0,
		...partial
	};
}

test('実行枠を占有するのは running と awaiting-approval', () => {
	assert.strictEqual(occupiesSlot('running'), true);
	assert.strictEqual(occupiesSlot('awaiting-approval'), true);
	assert.strictEqual(occupiesSlot('pending'), false);
	assert.strictEqual(occupiesSlot('review'), false);
	assert.strictEqual(occupiesSlot('done'), false);
});

test('再起動後、実行中だったタスクはレビュー待ちへ倒す', () => {
	// プロセスが死んだ時点でセッションも消えている。動いているように見せない
	assert.strictEqual(restoreState('running'), 'review');
	assert.strictEqual(restoreState('awaiting-approval'), 'review');
	assert.strictEqual(restoreState('pending'), 'pending');
	assert.strictEqual(restoreState('done'), 'done');
});

test('承認待ちの有無で running と awaiting-approval を行き来する', () => {
	assert.strictEqual(deriveState('running', true), 'awaiting-approval');
	assert.strictEqual(deriveState('awaiting-approval', false), 'running');
	assert.strictEqual(deriveState('review', true), 'review', 'レビュー待ちは承認とは無関係');
	assert.strictEqual(deriveState('done', true), 'done');
});

test('同時実行の上限に達していたら次を開始しない', () => {
	const tasks = [
		task({ taskId: 'a', state: 'running' }),
		task({ taskId: 'b', state: 'awaiting-approval' }),
		task({ taskId: 'c', state: 'pending' })
	];
	assert.strictEqual(nextStartable(tasks, 2, 0), undefined);
	assert.strictEqual(nextStartable(tasks, 3, 0)?.taskId, 'c');
});

test('起動処理中（in-flight）も枠に数える', () => {
	// await の隙間で二重に開始すると上限を超える。実際に旧版で塞いだ穴
	const tasks = [task({ taskId: 'a', state: 'running' }), task({ taskId: 'b', state: 'pending' })];
	assert.strictEqual(nextStartable(tasks, 2, 1), undefined);
	assert.strictEqual(nextStartable(tasks, 2, 0)?.taskId, 'b');
});

test('待機中が複数あれば古いものから開始する', () => {
	const tasks = [
		task({ taskId: 'new', state: 'pending', createdAt: 200 }),
		task({ taskId: 'old', state: 'pending', createdAt: 100 })
	];
	assert.strictEqual(nextStartable(tasks, 2, 0)?.taskId, 'old');
});

test('待機中が無ければ何も返さない', () => {
	assert.strictEqual(nextStartable([task({ taskId: 'a', state: 'review' })], 5, 0), undefined);
	assert.strictEqual(nextStartable([], 5, 0), undefined);
});

test('知らない状態・欠けた状態は、列のある pending へ寄せる（T-351）', () => {
	// 寄せないと、どの列にも入らないまま数にだけ残る（「全 3 なのにカードは 1 枚」）
	assert.deepStrictEqual(
		[
			normalizeState('banana'),
			normalizeState(null),
			normalizeState(undefined),
			normalizeState(42),
			normalizeState('pending'),
			normalizeState('running'),
			normalizeState('awaiting-approval'),
			normalizeState('review'),
			normalizeState('done')
		],
		['pending', 'pending', 'pending', 'pending', 'pending', 'running', 'awaiting-approval', 'review', 'done']
	);
	// 寄せ先は必ず列がある＝板に描ける（数えたものは必ず見える場所に出る）
	assert.ok(KANBAN_COLUMNS.some((column) => column.state === normalizeState('banana')));
});

test('Memento からの復元でも、知らない状態を通さない（T-351）', () => {
	// 既知の 5 状態に対する答えは今までどおり（上の「再起動後〜」のテストが押さえている）
	assert.deepStrictEqual(
		[
			restoreState('banana' as unknown as KanbanTask['state']),
			restoreState(undefined as unknown as KanbanTask['state'])
		],
		['pending', 'pending']
	);
});

test('板の列は英語で揃っている（T-257）', () => {
	// 一部だけ日本語に残すと 1 枚の板に 2 つの言語が混ざる。列ごと突き合わせる
	assert.deepStrictEqual(KANBAN_COLUMNS, [
		{ state: 'pending', label: 'To Do' },
		{ state: 'running', label: 'In Progress' },
		{ state: 'awaiting-approval', label: 'Needs Approval' },
		{ state: 'review', label: 'In Review' },
		{ state: 'done', label: 'Done' }
	]);
});
