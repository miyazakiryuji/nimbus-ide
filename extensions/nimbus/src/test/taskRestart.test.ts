/**
 * 再起動あとのタスクの状態（T-375）の単体テスト。
 *
 * **この不具合は、部品を別々に見ていると絶対に掴めない。** `restoreState()` は正しく
 * 「レビュー待ち」を返し、`mergeTasks()` は正しく「新しいほうを採る」。それぞれのテストは
 * 緑のまま、**起動の順番で合成したときだけ**壊れていた —
 * `restoreState()` が `updatedAt` を触らないので、ディスクに残った `running` と同時刻になり、
 * 「同時刻ならディスク側」の規則で押し戻される。
 * だからここでは**起動の順番そのもの**を組み立てて確かめる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { EventEmitter } from 'events';
import type { KanbanTask } from '../core/tasks';
import { TaskService } from '../tasks/TaskService';
import { TaskStore } from '../taskStore';
import { WorktreeManager } from '../core/worktree';

/** `Memento` の最小の代役。前回の窓が閉じたときの中身を持たせる */
function memento(initial: KanbanTask[]) {
	const values = new Map<string, unknown>([['nimbus.tasks', initial]]);
	return {
		keys: () => [...values.keys()],
		get: <T>(key: string, fallback?: T): T => (values.get(key) as T) ?? (fallback as T),
		update: async (key: string, value: unknown): Promise<void> => {
			values.set(key, value);
		}
	};
}

function runningTask(overrides: Partial<KanbanTask> = {}): KanbanTask {
	return {
		taskId: 't1',
		title: '直す',
		repoCwd: '/w/app',
		worktreePath: '/w/app-t1',
		branch: 'nimbus/t1',
		prompt: '直して',
		sessionId: 's1',
		state: 'running',
		createdAt: 1_000,
		// **ディスクと同時刻**。これが押し戻しの引き金
		updatedAt: 2_000,
		...overrides
	};
}

/** 前回の窓が残したものを再現して、いまの窓を起こす */
async function bootWith(task: KanbanTask): Promise<{ service: TaskService; store: TaskStore }> {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-taskrestart-')), 'tasks');
	const store = new TaskStore(dir);
	// ディスクには、前回の窓が書いたままの `running` が残っている
	await store.write(task);
	const service = new TaskService(
		memento([task]),
		new WorktreeManager(),
		new EventEmitter() as never,
		() => 4,
		() => undefined,
		store,
		'win-now'
	);
	return { service, store };
}

test('前回動いていたタスクは、起動直後の突き合わせでも「レビュー待ち」のまま（T-375）', async () => {
	const { service } = await bootWith(runningTask());

	// 台帳に生きた持ち主は居ない（＝前の窓は死んでいる）
	service.reconcileAfterRestart(new Set(), 3_000);
	await service.syncWithStore();

	assert.deepStrictEqual(
		service.list().map((t) => [t.taskId, t.state]),
		[['t1', 'review']]
	);
});

test('生きている窓が走らせているタスクは、レビュー待ちへ倒さない（T-375）', async () => {
	const { service } = await bootWith(runningTask());

	// **別の窓がいま `s1` を走らせている**。こちらの Memento にも写しが入っているだけ
	service.reconcileAfterRestart(new Set(['s1']), 3_000);
	await service.syncWithStore();

	assert.deepStrictEqual(
		service.list().map((t) => [t.taskId, t.state]),
		[['t1', 'running']]
	);
});

test('もともと走っていなかったタスクには手を触れない（T-375）', async () => {
	const { service } = await bootWith(runningTask({ state: 'pending', sessionId: undefined }));

	assert.strictEqual(service.reconcileAfterRestart(new Set(), 3_000), 0);
	await service.syncWithStore();

	assert.deepStrictEqual(
		service.list().map((t) => [t.taskId, t.state, t.updatedAt]),
		[['t1', 'pending', 2_000]]
	);
});
