/**
 * 板の読み書き（T-259 / T-261）の単体テスト。
 *
 * 確かめるのは **同時に書いても消えないこと**（1 タスク 1 ファイル・進捗は追記だけ）。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { KANBAN_COLUMNS, type KanbanTask } from '../core/tasks';
import { TaskStore } from '../taskStore';

function task(taskId: string): KanbanTask {
	return {
		taskId,
		title: `タスク ${taskId}`,
		repoCwd: '/w/app',
		worktreePath: `/w/app-${taskId}`,
		branch: `nimbus/${taskId}`,
		prompt: '直して',
		state: 'pending',
		createdAt: 1,
		updatedAt: 2
	};
}

function dir(): string {
	return join(mkdtempSync(join(tmpdir(), 'nimbus-tasks-')), 'tasks');
}

test('書いた板は、別のインスタンス（＝別ウィンドウ）から読める', async () => {
	const at = dir();
	const writer = new TaskStore(at);
	await writer.write(task('a'));
	const read = await new TaskStore(at).load();
	assert.deepStrictEqual(read, [task('a')]);
});

test('2 つのウィンドウが同時に書いても、どちらのタスクも消えない', async () => {
	const at = dir();
	const a = new TaskStore(at);
	const b = new TaskStore(at);
	await Promise.all([
		...Array.from({ length: 20 }, (_, i) => a.write(task(`a${i}`))),
		...Array.from({ length: 20 }, (_, i) => b.write(task(`b${i}`)))
	]);
	assert.strictEqual((await a.load()).length, 40);
});

test('進捗は追記だけなので、同時に書いても行が消えない', async () => {
	const at = dir();
	const a = new TaskStore(at);
	const b = new TaskStore(at);
	await Promise.all([
		...Array.from({ length: 50 }, (_, i) => a.appendProgress('t1', { at: i, kind: 'turn', text: `a${i}` })),
		...Array.from({ length: 50 }, (_, i) => b.appendProgress('t1', { at: 100 + i, kind: 'turn', text: `b${i}` }))
	]);
	const entries = await a.readProgress('t1');
	const last = await a.lastProgressAt();
	assert.deepStrictEqual([entries.length, last.get('t1')], [100, 149]);
});

test('知らない状態・欠けた状態の記録も、列のある状態にして読む（T-351）', async () => {
	// 別ウィンドウ・旧版・手編集が置いた札。素通しすると板のどの列にも入らないまま
	// 「全 N」にだけ残り、探しても見つからない仕事を数字が主張する
	const at = dir();
	mkdirSync(at, { recursive: true });
	writeFileSync(join(at, 'x.json'), JSON.stringify({ ...task('x'), state: 'banana' }), 'utf8');
	writeFileSync(join(at, 'y.json'), JSON.stringify({ ...task('y'), state: null }), 'utf8');
	const noticed: string[] = [];
	const store = new TaskStore(at, { log: (message) => noticed.push(message) });
	await store.write(task('z'));

	const read = (await store.load()).sort((a, b) => a.taskId.localeCompare(b.taskId));
	assert.deepStrictEqual(
		read.map((t) => [t.taskId, t.state]),
		[
			['x', 'pending'],
			['y', 'pending'],
			['z', 'pending']
		]
	);
	// 読めた札は必ず列がある＝板に描ける（数えたものは見える場所に出る）
	assert.ok(read.every((t) => KANBAN_COLUMNS.some((column) => column.state === t.state)));
	// 黙って寄せない。ただし 5 秒ごとの読み直しで同じ行を吐かない（2 件ぶんだけ）
	await store.load();
	assert.strictEqual(noticed.length, 2, noticed.join(' / '));
});

test('板から消すと、進捗の記録も残らない', async () => {
	const at = dir();
	const store = new TaskStore(at);
	await store.write(task('a'));
	await store.appendProgress('a', { at: 1, kind: 'note', text: 'メモ' });
	await store.remove('a');
	assert.deepStrictEqual([await store.load(), await store.readProgress('a')], [[], []]);
});
