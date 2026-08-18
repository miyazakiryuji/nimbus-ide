/**
 * 詰まったときに見る 3 つ（T-249）の単体テスト。
 *
 * ここが間違えると、**失敗を見落とす**か、失敗でないものを失敗として見せることになる。
 * どちらもデバッグ面としては致命的なので、拾う条件と拾わない条件の両方を押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import {
	findFailures,
	describeInput,
	failurePrompt,
	findRepetitions,
	pairToolCalls,
	signatureOf,
	stableStringify
} from '../core/debugInsight';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;

test('失敗を出どころごとに拾い、新しいものを上に置く', () => {
	const failures = findFailures([
		at(1, { kind: 'tool-use', toolUseId: 'a', toolName: 'Bash', input: { command: 'npm test' } }),
		at(2, { kind: 'tool-result', toolUseId: 'a', isError: true, preview: '1 failing\n  x broke' }),
		at(3, { kind: 'session-error', message: '接続が切れました' })
	]);

	assert.deepStrictEqual(failures, [
		{ at: 3, source: 'session', title: 'セッション', detail: '接続が切れました' },
		{ at: 2, source: 'tool', title: 'Bash', detail: '1 failing x broke', toolUseId: 'a' }
	]);
});

test('成功した呼び出しは失敗に混ぜない', () => {
	const failures = findFailures([
		at(1, { kind: 'tool-use', toolUseId: 'a', toolName: 'Read', input: { file_path: '/tmp/a.ts' } }),
		at(2, { kind: 'tool-result', toolUseId: 'a', isError: false, preview: 'ok' })
	]);

	assert.deepStrictEqual(failures, []);
});

test('フックは終わった段でだけ失敗と見なす（開始・進捗では拾わない）', () => {
	const started = at(1, {
		kind: 'hook',
		hookId: 'h1',
		hookName: 'guard',
		hookEvent: 'PreToolUse',
		phase: 'started'
	});
	const failed = at(2, {
		kind: 'hook',
		hookId: 'h1',
		hookName: 'guard',
		hookEvent: 'PreToolUse',
		phase: 'response',
		outcome: 'error',
		exitCode: 2,
		stderr: '書き込みは許可されていません'
	});

	assert.deepStrictEqual(findFailures([started]), []);
	assert.deepStrictEqual(findFailures([started, failed]), [
		{ at: 2, source: 'hook', title: 'PreToolUse: guard', detail: '書き込みは許可されていません' }
	]);
});

test('サブエージェントとターンの失敗も拾う', () => {
	const failures = findFailures([
		at(1, {
			kind: 'subagent',
			taskId: 't1',
			phase: 'updated',
			description: '調査',
			status: 'failed',
			error: 'ツールが見つかりません'
		}),
		at(2, { kind: 'turn-result', subtype: 'error_max_turns', isError: true, numTurns: 30, durationMs: 100 })
	]);

	assert.deepStrictEqual(failures, [
		{ at: 2, source: 'turn', title: 'ターン', detail: 'error_max_turns' },
		{ at: 1, source: 'subagent', title: '調査', detail: 'ツールが見つかりません' }
	]);
});

test('鍵の順番が違っても同じ入力として数える', () => {
	assert.strictEqual(
		signatureOf('Grep', { pattern: 'foo', path: 'src' }),
		signatureOf('Grep', { path: 'src', pattern: 'foo' })
	);
	assert.strictEqual(stableStringify({ b: 1, a: [2, { d: 4, c: 3 }] }), '{"a":[2,{"c":3,"d":4}],"b":1}');
});

test('同じ呼び出しの繰り返しを、閾値以上のときだけ出す', () => {
	const events = [
		at(1, { kind: 'tool-use', toolUseId: 'a', toolName: 'Read', input: { file_path: '/a.ts' } }),
		at(2, { kind: 'tool-use', toolUseId: 'b', toolName: 'Read', input: { file_path: '/a.ts' } }),
		at(3, { kind: 'tool-use', toolUseId: 'c', toolName: 'Read', input: { file_path: '/a.ts' } }),
		// 別のファイルは 2 回だけ。閾値に届かない
		at(4, { kind: 'tool-use', toolUseId: 'd', toolName: 'Read', input: { file_path: '/b.ts' } }),
		at(5, { kind: 'tool-use', toolUseId: 'e', toolName: 'Read', input: { file_path: '/b.ts' } })
	];

	assert.deepStrictEqual(findRepetitions(events), [
		{ toolName: 'Read', summary: '/a.ts', count: 3, firstAt: 1, lastAt: 3 }
	]);
});

test('呼び出しと結果を対にし、返っていないものも落とさない', () => {
	const calls = pairToolCalls([
		at(10, { kind: 'tool-use', toolUseId: 'a', toolName: 'Bash', input: { command: 'ls' } }),
		at(1500, { kind: 'tool-result', toolUseId: 'a', isError: false, preview: 'a.ts' }),
		at(2000, { kind: 'tool-use', toolUseId: 'b', toolName: 'Read', input: { file_path: '/x.ts' } })
	]);

	assert.deepStrictEqual(calls, [
		{
			toolUseId: 'b',
			toolName: 'Read',
			at: 2000,
			input: { file_path: '/x.ts' },
			summary: '/x.ts'
		},
		{
			toolUseId: 'a',
			toolName: 'Bash',
			at: 10,
			input: { command: 'ls' },
			summary: 'ls',
			failed: false,
			result: 'a.ts',
			durationMs: 1490
		}
	]);
});

test('入力は「何に対して」を優先して 1 行にする', () => {
	assert.deepStrictEqual(
		[
			describeInput({ command: 'npm  test' }),
			describeInput({ file_path: '/a.ts', offset: 3 }),
			describeInput({ limit: 5 }),
			describeInput(undefined)
		],
		['npm test', '/a.ts', '{"limit":5}', '']
	);
});

test('失敗は、そのまま投げられる文面になる', () => {
	const text = failurePrompt({ at: 1, source: 'tool', title: 'Bash', detail: 'exit 1' });

	assert.ok(text.includes('ツール'), text);
	assert.ok(text.includes('Bash'), text);
	assert.ok(text.includes('exit 1'), text);
});
