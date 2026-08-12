/**
 * 見積もり（T-187）と、頼みかたの型（T-188 / T-189）の単体テスト。
 *
 * 見積もりは **「予測」ではなく「これまでの実績」** であることが要。
 * 予測のふりをすると、外れたときに信用を失う。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { collectSamples, describeEstimate, estimate, median } from '../core/estimate';
import { COMPARE_OPTIONS_PROMPT, disagreementPrompt } from '../core/dialogue';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;

const turn = (t: number, durationMs: number, tokens: number): NimbusEvent =>
	at(t, {
		kind: 'turn-result',
		subtype: 'success',
		isError: false,
		numTurns: 1,
		durationMs,
		usage: { inputTokens: tokens, outputTokens: 0 }
	});

test('中央値は外れ値に引きずられない', () => {
	assert.strictEqual(median([1, 2, 3]), 2);
	assert.strictEqual(median([1, 2, 3, 100]), 3);
	assert.strictEqual(median([2, 4]), 3);
	assert.strictEqual(median([]), undefined);
});

test('標本はターンごとに、書き換え数と所要とトークンを揃える', () => {
	const samples = collectSamples([
		at(1, { kind: 'user-text', text: '直して' }),
		at(2, { kind: 'tool-use', toolUseId: 'u1', toolName: 'Edit', input: { file_path: '/w/a.ts' } }),
		turn(3, 5000, 1000)
	]);
	assert.deepStrictEqual(samples, [{ files: 1, durationMs: 5000, tokens: 1000 }]);
});

test('標本が無ければ、無いと言う（0 と言わない）', () => {
	const value = estimate([]);
	assert.strictEqual(value.samples, 0);
	assert.strictEqual(describeEstimate(value), 'まだ標本がありません（1 ターン終わると出せます）');
});

test('直近 5 ターンだけを見る（古い傾向を引きずらない）', () => {
	const events: NimbusEvent[] = [];
	for (let i = 0; i < 8; i++) {
		events.push(turn(i, (i + 1) * 1000, 0));
	}
	assert.strictEqual(estimate(events).samples, 5);
});

test('言葉は「これまではこうだった」としか言わない', () => {
	const text = describeEstimate(estimate([turn(1, 60_000, 12_000), turn(2, 60_000, 12_000)]));
	assert.ok(text.startsWith('直近 2 ターンの中央値:'), text);
	assert.ok(text.includes('1 分'), text);
	assert.ok(text.includes('12k トークン'), text);
	// 「こうなります」とは言わない
	assert.ok(!text.includes('でしょう') && !text.includes('見込み'), text);
});

test('比較の依頼は「まだ変更しないで」を含む', () => {
	assert.ok(COMPARE_OPTIONS_PROMPT.includes('まだ変更はしないでください'));
	assert.ok(COMPARE_OPTIONS_PROMPT.includes('表'));
});

test('相違の記録は「どちらが正しいかを決めつけない」を含む', () => {
	const prompt = disagreementPrompt('既存を活かす', '作り直す');
	assert.ok(prompt.includes('決めつけないでください'));
	assert.ok(prompt.includes('既存を活かす'));
	assert.ok(prompt.includes('作り直す'));
	// 後から検証できる形にさせる
	assert.ok(prompt.includes('検証'));
});
