/**
 * tasks.md とタスク板の対応づけ（T-013）と、待機列の優先度（T-233）の単体テスト。
 *
 * `tasks.md` は**複数の AI が同時に触るファイル**なので、
 * 行を書き換えず**行ごと動かす**ことが要。書き換えると機械的にマージできなくなる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { moveToDone, parseTasksFile, startableEntries } from '../core/tasksFile';
import { nextStartable, PRIORITY_ORDER, type KanbanTask } from '../core/tasks';

const SAMPLE = [
	'# Nimbus タスク',
	'',
	'## Inbox（未整理）',
	'',
	'- [ ] T-014 ターミナルを好きな数に分割できるようにする',
	'      複数エージェントの出力を同時に見たい [P2]',
	'',
	'## 進行中',
	'',
	'- [ ] T-033 スクラッチファイル @claude 2026-08-13 [P1]',
	'',
	'## 次にやる',
	'',
	'- [ ] T-002 **localize() の掃除** [P1]',
	'- [ ] T-005 Copilot を外す [P3]',
	'',
	'## 完了',
	'',
	'新しい順。',
	'',
	'- [x] T-001 独自テーマ — 2026-08-13',
	''
].join('\n');

test('定義行だけを項目として拾い、折り返しも取り込む', () => {
	const entries = parseTasksFile(SAMPLE);
	assert.deepStrictEqual(entries.map((e) => e.id), ['T-014', 'T-033', 'T-002', 'T-005', 'T-001']);
	assert.ok(entries[0].raw.includes('複数エージェントの出力'));
});

test('セクション・優先度・完了・claim を読み取る', () => {
	const entries = parseTasksFile(SAMPLE);
	const byId = Object.fromEntries(entries.map((e) => [e.id, e]));
	assert.deepStrictEqual(
		[byId['T-014'].section, byId['T-014'].priority, byId['T-014'].claimed],
		['Inbox（未整理）', 'P2', false]
	);
	assert.strictEqual(byId['T-033'].claimed, true);
	assert.strictEqual(byId['T-001'].done, true);
	// 見出しから ID・優先度・装飾を落とす
	assert.strictEqual(byId['T-002'].title, 'localize() の掃除');
});

test('着手候補は完了済みと claim 済みを外し、優先度順に並べる', () => {
	const startable = startableEntries(parseTasksFile(SAMPLE));
	assert.deepStrictEqual(startable.map((e) => e.id), ['T-002', 'T-014', 'T-005']);
});

test('完了へ移すときは行ごと動かす（本文を書き換えない）', () => {
	const updated = moveToDone(SAMPLE, 'T-002', '2026-08-14 / 掃除した');
	assert.ok(updated);
	// 元の場所から消えている
	assert.ok(!updated!.includes('- [ ] T-002'));
	// 完了セクションの先頭に入っている
	const done = updated!.slice(updated!.indexOf('## 完了'));
	assert.ok(done.includes('- [x] T-002 localize() の掃除 — 2026-08-14 / 掃除した'));
	assert.ok(done.indexOf('T-002') < done.indexOf('T-001'), '新しい順に入っていない');
	// 他の行は 1 つも変わっていない
	assert.ok(updated!.includes('- [ ] T-005 Copilot を外す [P3]'));
	assert.ok(updated!.includes('- [ ] T-033 スクラッチファイル @claude 2026-08-13 [P1]'));
});

test('見つからない・すでに完了しているものは触らない', () => {
	assert.strictEqual(moveToDone(SAMPLE, 'T-999', ''), undefined);
	assert.strictEqual(moveToDone(SAMPLE, 'T-001', ''), undefined);
});

test('完了セクションが無いファイルは壊さない', () => {
	assert.strictEqual(moveToDone('## 次にやる\n\n- [ ] T-002 x\n', 'T-002', ''), undefined);
});

// --- 待機列の優先度（T-233） ---

const task = (taskId: string, createdAt: number, priority?: 'high' | 'normal' | 'low'): KanbanTask => ({
	taskId,
	title: taskId,
	repoCwd: '/w',
	worktreePath: `/w/${taskId}`,
	branch: taskId,
	prompt: '',
	state: 'pending',
	priority,
	createdAt,
	updatedAt: createdAt
});

test('優先度が高いものを先に、同じなら作った順', () => {
	const tasks = [task('a', 1), task('b', 2, 'high'), task('c', 3, 'high'), task('d', 4, 'low')];
	assert.strictEqual(nextStartable(tasks, 2, 0)?.taskId, 'b');
	assert.strictEqual(nextStartable([task('a', 1), task('d', 0, 'low')], 2, 0)?.taskId, 'a');
});

test('優先度が無い既存データは normal として扱う（保存済みを壊さない）', () => {
	assert.strictEqual(PRIORITY_ORDER.normal, 1);
	assert.strictEqual(nextStartable([task('old', 1), task('low', 0, 'low')], 2, 0)?.taskId, 'old');
});

test('上限に達していれば、優先度が高くても開始しない', () => {
	assert.strictEqual(nextStartable([task('b', 1, 'high')], 1, 1), undefined);
});
