/**
 * 監査ログと時系列（T-050 / T-015 / T-184）の単体テスト。
 *
 * 監査は**後から辿るためのもの**なので、残すものを絞りすぎても残しすぎても困る。
 * 「失敗を失敗として拾えるか」を特に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { buildTimeline, countByKind, toAuditRecord, toJsonLine } from '../core/audit';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;

test('表示用の細かいイベントは監査に残さない', () => {
	assert.strictEqual(toAuditRecord(at(1, { kind: 'assistant-text', text: 'x' })), undefined);
	assert.strictEqual(toAuditRecord(at(1, { kind: 'assistant-thinking', text: 'x' })), undefined);
	assert.strictEqual(toAuditRecord(at(1, { kind: 'status', status: 'running' })), undefined);
});

test('ツール実行は「何に対して」を残す', () => {
	const record = toAuditRecord(at(1000, { kind: 'tool-use', toolUseId: 'u', toolName: 'Edit', input: { file_path: '/w/a.ts' } }));
	assert.deepStrictEqual([record?.kind, record?.subject], ['tool-use', 'Edit: /w/a.ts']);
	const bash = toAuditRecord(at(1, { kind: 'tool-use', toolUseId: 'u', toolName: 'Bash', input: { command: 'npm  test' } }));
	assert.strictEqual(bash?.subject, 'Bash: npm test');
});

test('失敗を失敗として拾う', () => {
	assert.strictEqual(toAuditRecord(at(1, { kind: 'tool-result', toolUseId: 'u', isError: true, preview: 'こわれた' }))?.outcome, '失敗');
	assert.strictEqual(toAuditRecord(at(1, { kind: 'tool-result', toolUseId: 'u', isError: false, preview: '' }))?.outcome, '成功');
	assert.strictEqual(
		toAuditRecord(at(1, { kind: 'turn-result', subtype: 'error_during_execution', isError: true, numTurns: 1, durationMs: 1 }))?.outcome,
		'失敗（error_during_execution）'
	);
});

test('時刻は ISO で残す（機械で読めるように）', () => {
	const record = toAuditRecord(at(Date.parse('2026-08-13T12:00:00.000Z'), { kind: 'user-text', text: '指示' }));
	assert.strictEqual(record?.at, '2026-08-13T12:00:00.000Z');
	assert.strictEqual(record?.detail, '指示');
});

test('JSONL の 1 行になる', () => {
	const line = toJsonLine({ at: '2026-08-13T12:00:00.000Z', sessionId: 's1', kind: 'user-text' });
	assert.ok(line.endsWith('\n'));
	assert.deepStrictEqual(JSON.parse(line).kind, 'user-text');
});

test('時系列は畳まず、新しいものを上に並べる', () => {
	const rows = buildTimeline([
		at(1, { kind: 'user-text', text: '直して' }),
		at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: { file_path: '/w/a.ts' } }),
		at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Read', input: { file_path: '/w/a.ts' } })
	]);
	// 同じ Read が 2 回とも残る（畳むと「何回起きたか」が消える）
	assert.strictEqual(rows.length, 3);
	assert.deepStrictEqual(rows.map((r) => r.at), [3, 2, 1]);
});

test('失敗した行に印が付く', () => {
	const rows = buildTimeline([at(1, { kind: 'tool-result', toolUseId: 'u', isError: true, preview: 'だめ' })]);
	assert.strictEqual(rows[0].failed, true);
});

test('上限を超えたら新しいほうを残す', () => {
	const events = Array.from({ length: 10 }, (_, i) => at(i, { kind: 'user-text', text: `指示 ${i}` }));
	const rows = buildTimeline(events, 3);
	assert.deepStrictEqual(rows.map((r) => r.at), [9, 8, 7]);
});

test('種類ごとの件数を多い順に出す', () => {
	const rows = buildTimeline([
		at(1, { kind: 'user-text', text: 'a' }),
		at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Read', input: {} }),
		at(3, { kind: 'tool-use', toolUseId: 'u2', toolName: 'Read', input: {} })
	]);
	assert.deepStrictEqual(countByKind(rows), [{ kind: 'tool-use', count: 2 }, { kind: 'user-text', count: 1 }]);
});
