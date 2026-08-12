/**
 * 「セッションの中身」を組み立てる処理の単体テスト。
 *
 * イベントは同じ ID で何度も流れてくるので、**畳んだ結果が正しいか**がすべて。
 * 特に「後から来た undefined で既知の値を消さない」ことは、進捗表示が
 * 途中で空になる形で壊れるため必ず押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import {
	buildActivity,
	buildAttributions,
	describeCompaction,
	hookIcon,
	runningTool,
	subagentIcon
} from '../core/activity';
import { buildNotifyCommand, oneLine } from '../core/notify';

const SESSION = 's1';

/** 共用体のまま各枝から共通フィールドを外す（素の Omit だと共通キーだけに潰れる） */
type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;

function at(timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent {
	return { ...event, sessionId: SESSION, timestamp } as NimbusEvent;
}

test('サブエージェントは開始・進捗・終了を 1 件に畳む', () => {
	const activity = buildActivity([
		at(1, { kind: 'subagent', phase: 'started', taskId: 't1', description: '調査', subagentType: 'Explore', prompt: '探して' }),
		at(2, {
			kind: 'subagent',
			phase: 'progress',
			taskId: 't1',
			description: '調査',
			lastToolName: 'Grep',
			usage: { totalTokens: 1200, toolUses: 3, durationMs: 4500 }
		}),
		at(3, { kind: 'subagent', phase: 'updated', taskId: 't1', status: 'completed' })
	]);
	assert.deepStrictEqual(activity.subagents, [
		{
			taskId: 't1',
			description: '調査',
			subagentType: 'Explore',
			prompt: '探して',
			status: 'completed',
			lastToolName: 'Grep',
			totalTokens: 1200,
			toolUses: 3,
			durationMs: 4500,
			startedAt: 1,
			updatedAt: 3
		}
	]);
});

test('後から来たイベントで、既に分かっている値を消さない', () => {
	const activity = buildActivity([
		at(1, { kind: 'subagent', phase: 'started', taskId: 't1', description: '調査', subagentType: 'Explore' }),
		// status だけを載せた更新。description / subagentType は落ちてはいけない
		at(2, { kind: 'subagent', phase: 'updated', taskId: 't1', status: 'failed', error: '落ちた' })
	]);
	assert.deepStrictEqual(
		[activity.subagents[0].description, activity.subagents[0].subagentType, activity.subagents[0].error],
		['調査', 'Explore', '落ちた']
	);
});

test('サブエージェントは開始が新しい順に並ぶ', () => {
	const activity = buildActivity([
		at(1, { kind: 'subagent', phase: 'started', taskId: 'old', description: '古い' }),
		at(5, { kind: 'subagent', phase: 'started', taskId: 'new', description: '新しい' })
	]);
	assert.deepStrictEqual(
		activity.subagents.map((s) => s.taskId),
		['new', 'old']
	);
});

test('フックは発火と応答を 1 件に畳み、落ちたものが分かる', () => {
	const activity = buildActivity([
		at(1, { kind: 'hook', phase: 'started', hookId: 'h1', hookName: 'guard.sh', hookEvent: 'PreToolUse' }),
		at(2, {
			kind: 'hook',
			phase: 'response',
			hookId: 'h1',
			hookName: 'guard.sh',
			hookEvent: 'PreToolUse',
			outcome: 'error',
			exitCode: 2,
			stderr: '拒否しました'
		})
	]);
	assert.deepStrictEqual(activity.hooks, [
		{
			hookId: 'h1',
			hookName: 'guard.sh',
			hookEvent: 'PreToolUse',
			outcome: 'error',
			exitCode: 2,
			stderr: '拒否しました',
			startedAt: 1,
			finishedAt: 2
		}
	]);
	assert.strictEqual(hookIcon(activity.hooks[0]), 'error');
});

test('触ったファイルは読みと書きを分けて数える', () => {
	const activity = buildActivity([
		at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: { file_path: '/w/a.ts' } }),
		at(2, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Read', input: { file_path: '/w/a.ts' } }),
		at(3, { kind: 'tool-use', toolUseId: 'u3', toolName: 'Edit', input: { file_path: '/w/a.ts' } }),
		at(4, { kind: 'tool-use', toolUseId: 'u4', toolName: 'Write', input: { file_path: '/w/b.ts' } })
	]);
	assert.deepStrictEqual(activity.files, [
		{ path: '/w/b.ts', reads: 0, writes: 1, lastAt: 4 },
		{ path: '/w/a.ts', reads: 2, writes: 1, lastAt: 3 }
	]);
});

test('ファイルを触らないツールは一覧に入れない', () => {
	const activity = buildActivity([
		at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Bash', input: { command: 'ls' } }),
		at(2, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Grep', input: { pattern: 'x' } }),
		at(3, { kind: 'tool-use', toolUseId: 'u3', toolName: 'Read', input: {} })
	]);
	assert.deepStrictEqual(activity.files, []);
});

test('コンパクションは新しい順に並び、削減率を出す', () => {
	const activity = buildActivity([
		at(1, { kind: 'compaction', trigger: 'auto', preTokens: 100_000, postTokens: 25_000 }),
		at(2, { kind: 'compaction', trigger: 'manual', preTokens: 80_000 })
	]);
	assert.deepStrictEqual(
		activity.compactions.map(describeCompaction),
		['手動 · 80,000 トークンから', '自動 · 100,000 → 25,000（75% 削減）']
	);
});

test('何も起きていなければ、どの一覧も空', () => {
	assert.deepStrictEqual(buildActivity([]), { subagents: [], hooks: [], files: [], compactions: [] });
});

test('状態の記号は走行中・成功・失敗で変わる', () => {
	assert.deepStrictEqual(
		[subagentIcon('running'), subagentIcon('completed'), subagentIcon('failed')],
		['sync', 'pass', 'error']
	);
});

// --- OS 通知（T-019） ---

test('macOS の通知は本文をスクリプトに埋め込まず引数で渡す（壊れない・実行されない）', () => {
	const command = buildNotifyCommand('darwin', 'タイトル', '本文に "引用符" と $(echo x) が入っても平気');
	assert.strictEqual(command?.command, 'osascript');
	// 本文とタイトルは `--` の後ろ＝argv として渡り、スクリプト文字列には現れない
	assert.deepStrictEqual(command?.args.slice(-3), [
		'--',
		'本文に "引用符" と $(echo x) が入っても平気',
		'タイトル'
	]);
	assert.ok(!command?.args.slice(0, -3).some((arg) => arg.includes('引用符')));
});

test('通知を出せないプラットフォームでは undefined（呼び出し側がウィンドウ内に落とす）', () => {
	assert.strictEqual(buildNotifyCommand('win32', 't', 'b'), undefined);
	assert.deepStrictEqual(buildNotifyCommand('linux', 't', 'b'), {
		command: 'notify-send',
		args: ['--app-name=Nimbus', 't', 'b']
	});
});

test('通知の本文は 1 行に畳む', () => {
	assert.strictEqual(oneLine('  複数\n行の  文章  '), '複数 行の 文章');
	assert.strictEqual(oneLine('x'.repeat(200)).length, 121);
});

// --- 指示と修正の紐づけ（T-024）・思考中の可視化（T-192） ---

test('修正は、きっかけになった指示ごとにまとまる', () => {
	const attributions = buildAttributions([
		at(1, { kind: 'user-text', text: 'ログを直して' }),
		at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: { file_path: '/w/log.ts' } }),
		at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Edit', input: { file_path: '/w/log.ts' } }),
		at(4, { kind: 'user-text', text: 'テストも足して' }),
		at(5, { kind: 'tool-use', toolUseId: 'u3', toolName: 'Write', input: { file_path: '/w/log.test.ts' } })
	]);
	assert.deepStrictEqual(attributions, [
		{
			prompt: 'テストも足して',
			at: 4,
			edits: [{ path: '/w/log.test.ts', toolName: 'Write', at: 5 }],
			reads: []
		},
		{
			prompt: 'ログを直して',
			at: 1,
			edits: [{ path: '/w/log.ts', toolName: 'Edit', at: 3 }],
			reads: ['/w/log.ts']
		}
	]);
});

test('修正が生まれなかった指示は出さない（見たいのは修正の出どころ）', () => {
	const attributions = buildAttributions([
		at(1, { kind: 'user-text', text: '調べるだけ' }),
		at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: { file_path: '/w/a.ts' } })
	]);
	assert.deepStrictEqual(attributions, []);
});

test('指示より前のツール実行は、どの指示にも紐づけない', () => {
	const attributions = buildAttributions([
		at(1, { kind: 'tool-use', toolUseId: 'u0', toolName: 'Edit', input: { file_path: '/w/orphan.ts' } }),
		at(2, { kind: 'user-text', text: '指示' }),
		at(3, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/a.ts' } })
	]);
	assert.deepStrictEqual(attributions.length, 1);
	assert.deepStrictEqual(attributions[0].edits.map((e) => e.path), ['/w/a.ts']);
});

test('走っているツールは、結果が返っていない最後の呼び出し', () => {
	assert.deepStrictEqual(
		runningTool([
			at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: { file_path: '/w/a.ts' } }),
			at(2, { kind: 'tool-result', toolUseId: 'u1', isError: false, preview: '' }),
			at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Bash', input: { command: 'npm  test\n' } })
		]),
		{ toolName: 'Bash', target: 'npm test', since: 3 }
	);
});

test('ターンが終わっていれば、走っているツールは無い', () => {
	assert.strictEqual(
		runningTool([
			at(1, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: { file_path: '/w/a.ts' } }),
			at(2, { kind: 'turn-result', subtype: 'success', isError: false, numTurns: 1, durationMs: 10 })
		]),
		undefined
	);
	assert.strictEqual(runningTool([]), undefined);
});
