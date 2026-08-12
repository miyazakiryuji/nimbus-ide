/**
 * 圧縮前の選別（T-154）の単体テスト。
 *
 * 何も選ばなかったときに**これまでどおり**（素の `/compact`）に戻ることが要。
 * 空の指示を付けて送ると、要約の質が落ちる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { buildCompactCommand, compactCandidates } from '../core/compactSelection';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;

const EVENTS: NimbusEvent[] = [
	at(1, { kind: 'user-text', text: 'ログイン画面のバリデーションを直して' }),
	at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/a.ts' } }),
	at(3, { kind: 'turn-result', subtype: 'success', isError: false, numTurns: 1, durationMs: 10, resultText: 'メール形式の検証を足しました' }),
	at(4, { kind: 'user-text', text: 'はい' }),
	at(5, { kind: 'user-text', text: 'パスワードの長さも見てほしい' })
];

test('候補は指示とまとめだけ。ツールの出入りは入れない', () => {
	assert.deepStrictEqual(
		compactCandidates(EVENTS).map((candidate) => candidate.kind),
		['instruction', 'decision', 'instruction']
	);
});

test('短すぎる発言は候補にしない（「はい」を選ぶ意味がない）', () => {
	assert.ok(!compactCandidates(EVENTS).some((candidate) => candidate.text === 'はい'));
});

test('候補は新しい順（残したいのはたいてい直近）', () => {
	assert.deepStrictEqual(
		compactCandidates(EVENTS).map((candidate) => candidate.at),
		[5, 3, 1]
	);
});

test('何も選ばなければ、これまでどおり素の /compact', () => {
	assert.strictEqual(buildCompactCommand([]), '/compact');
});

test('選んだものは古い順に並べ直して渡す（時系列が逆だと読みにくい）', () => {
	const candidates = compactCandidates(EVENTS);
	const command = buildCompactCommand(candidates);
	assert.ok(command.startsWith('/compact 次の点は要約後も必ず残してください'));
	const body = command.split('\n').slice(1);
	assert.deepStrictEqual(body, [
		'- ログイン画面のバリデーションを直して',
		'- メール形式の検証を足しました',
		'- パスワードの長さも見てほしい'
	]);
});
