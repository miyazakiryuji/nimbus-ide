/**
 * 板の突き合わせと、止まっているタスクの見つけかた（T-259 / T-262）の単体テスト。
 *
 * 要は 2 つ — **他のウィンドウが消したものと、まだ書いていないものを取り違えない**こと、
 * **担当セッションが死んでいるタスクを「作業中」のまま放置しない**こと。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { KanbanTask } from '../core/tasks';
import { checkTaskHealth, mergeTasks, summarizeProgress } from '../core/taskSync';

const NOW = 10_000_000;

function task(overrides: Partial<KanbanTask> & { taskId: string }): KanbanTask {
	return {
		title: `タスク ${overrides.taskId}`,
		repoCwd: '/w/app',
		worktreePath: `/w/app-${overrides.taskId}`,
		branch: `nimbus/${overrides.taskId}`,
		prompt: '直して',
		state: 'pending',
		createdAt: NOW - 100_000,
		updatedAt: NOW - 100_000,
		...overrides
	};
}

test('別のウィンドウが足したタスクを取り込み、新しいほうを勝たせる', () => {
	const mine = [task({ taskId: 'a', updatedAt: NOW }), task({ taskId: 'b', updatedAt: NOW - 5_000 })];
	const disk = [
		task({ taskId: 'a', updatedAt: NOW - 9_000 }),
		task({ taskId: 'b', updatedAt: NOW - 1_000, state: 'running' }),
		task({ taskId: 'c' })
	];
	const merged = mergeTasks(mine, disk, new Set(['a', 'b']));
	assert.deepStrictEqual(
		{
			tasks: merged.tasks.map((t) => [t.taskId, t.state]),
			toWrite: merged.toWrite.map((t) => t.taskId),
			removed: merged.removed,
			changed: merged.changed
		},
		{
			tasks: [['a', 'pending'], ['b', 'running'], ['c', 'pending']],
			toWrite: ['a'],
			removed: [],
			changed: true
		}
	);
});

test('ディスクから消えたものは落とすが、まだ書いていないものは残す', () => {
	const mine = [task({ taskId: 'gone' }), task({ taskId: 'fresh' })];
	const merged = mergeTasks(mine, [], new Set(['gone']));
	assert.deepStrictEqual(
		{ tasks: merged.tasks.map((t) => t.taskId), toWrite: merged.toWrite.map((t) => t.taskId), removed: merged.removed },
		{ tasks: ['fresh'], toWrite: ['fresh'], removed: ['gone'] }
	);
});

test('中身が同じなら changed にしない（画面を作り直さない）', () => {
	const mine = [task({ taskId: 'a' })];
	assert.strictEqual(mergeTasks(mine, [task({ taskId: 'a' })], new Set(['a'])).changed, false);
});

test('担当セッションが死んでいる作業中タスクを、止まっているものとして出す', () => {
	const tasks = [
		task({ taskId: 'orphan', state: 'running', sessionId: 's-dead', updatedAt: NOW - 1_000 }),
		task({ taskId: 'healthy', state: 'running', sessionId: 's-live', updatedAt: NOW - 1_000 }),
		task({ taskId: 'silent', state: 'running', sessionId: 's-live', updatedAt: NOW - 60 * 60 * 1000 }),
		task({ taskId: 'waiting', state: 'pending', updatedAt: NOW - 60 * 60 * 1000 }),
		task({ taskId: 'left', state: 'done', updatedAt: NOW - 1_000 })
	];
	const found = checkTaskHealth(tasks, {
		now: NOW,
		liveSessionIds: new Set(['s-live']),
		hasWorktree: (t) => t.taskId === 'left'
	});
	assert.deepStrictEqual(
		found.map((entry) => [entry.task.taskId, entry.reason]),
		[
			['silent', 'no-progress'],
			['waiting', 'never-started'],
			['orphan', 'owner-gone'],
			['left', 'done-but-left']
		]
	);
});

test('進捗が記録されていれば、最終更新が古くても止まっていることにしない', () => {
	const tasks = [task({ taskId: 'a', state: 'running', sessionId: 's', updatedAt: NOW - 60 * 60 * 1000 })];
	const found = checkTaskHealth(tasks, {
		now: NOW,
		liveSessionIds: new Set(['s']),
		lastProgressAt: new Map([['a', NOW - 1_000]])
	});
	assert.deepStrictEqual(found, []);
});

test('進捗の要約は、ターン数と触ったファイルを畳む', () => {
	assert.deepStrictEqual(
		summarizeProgress([
			{ at: 1, kind: 'start', text: '開始' },
			{ at: 2, kind: 'file', text: '/w/a.ts' },
			{ at: 3, kind: 'file', text: '/w/a.ts' },
			{ at: 4, kind: 'turn', text: '1 ターン目' }
		]),
		{ last: { at: 4, kind: 'turn', text: '1 ターン目' }, turns: 1, files: ['/w/a.ts'] }
	);
});
