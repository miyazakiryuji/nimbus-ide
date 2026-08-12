/**
 * コンテキストのピン留め・予算・効率（T-152 / T-153 / T-156）の単体テスト。
 *
 * ピン留めは**毎ターン積まれる**ので、上限を守れないと他のことを何も覚えられなくなる。
 * 予算と効率は「数字を出す」だけの機能に見えて、0 件のときの扱いを誤ると嘘になる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { buildPinnedPrompt, describePinned, selectWithinBudget } from '../core/pinned';
import { budgetGauge, thresholdLevel } from '../core/usage';
import { contextEfficiency, describeEfficiency } from '../core/efficiency';

type EventBody<T> = T extends NimbusEvent ? Omit<T, 'sessionId' | 'timestamp'> : never;
const at = (timestamp: number, event: EventBody<NimbusEvent>): NimbusEvent =>
	({ ...event, sessionId: 's1', timestamp }) as NimbusEvent;
const read = (t: number, id: string, path: string): NimbusEvent =>
	at(t, { kind: 'tool-use', toolUseId: id, toolName: 'Read', input: { file_path: path } });

// --- ピン留め（T-152） ---

test('上限に収まるぶんだけ選び、指定した順を守る', () => {
	const selection = selectWithinBudget(
		[
			{ path: 'a.md', content: 'x'.repeat(10) },
			{ path: 'b.md', content: 'y'.repeat(10) },
			{ path: 'c.md', content: 'z'.repeat(10) }
		],
		25
	);
	assert.deepStrictEqual(selection.included.map((f) => f.path), ['a.md', 'b.md']);
	assert.deepStrictEqual(selection.dropped, ['c.md']);
	assert.strictEqual(selection.bytes, 20);
});

test('入らなかったものは黙って切らず、名前を残す', () => {
	const selection = selectWithinBudget([{ path: 'huge.md', content: 'x'.repeat(100) }], 10);
	assert.deepStrictEqual([selection.included, selection.dropped], [[], ['huge.md']]);
});

test('プロンプトには前提であることと、写しであることを書く', () => {
	const prompt = buildPinnedPrompt([{ path: 'RULES.md', content: 'タブを使う' }]);
	assert.ok(prompt.includes('RULES.md'));
	assert.ok(prompt.includes('タブを使う'));
	assert.ok(prompt.includes('前提'));
	// 途中で変わっても追従しないことを明示していないと、古い内容を信じ続ける
	assert.ok(prompt.includes('読み直して'));
});

test('ピン留めが無ければプロンプトも空（余計な前置きを積まない）', () => {
	assert.strictEqual(buildPinnedPrompt([]), '');
	assert.strictEqual(describePinned(selectWithinBudget([])), 'ピン留めなし');
});

// --- 予算（T-153） ---

test('予算 0 は「予算なし」。ゲージも出さない', () => {
	assert.strictEqual(budgetGauge(1000, 0), undefined);
	assert.strictEqual(thresholdLevel(1000, 0), 'none');
});

test('予算は 8 割で警告、超えたら over', () => {
	assert.deepStrictEqual(
		[thresholdLevel(700, 1000), thresholdLevel(800, 1000), thresholdLevel(1000, 1000)],
		['none', 'warn', 'over']
	);
});

test('予算ゲージは使用量と上限を並べる', () => {
	assert.strictEqual(budgetGauge(50_000, 200_000)?.detail, '50.0k / 200.0k · 25%');
});

// --- 効率（T-156） ---

test('1 ファイル 1 回で読めていれば満点', () => {
	const efficiency = contextEfficiency([read(1, 'u1', '/w/a.ts'), read(2, 'u2', '/w/b.ts')]);
	assert.deepStrictEqual(
		[efficiency.totalReads, efficiency.uniqueFiles, efficiency.rereads, efficiency.score],
		[2, 2, 0, 100]
	);
	assert.strictEqual(describeEfficiency(efficiency), '100% · 読み直しなし');
});

test('読み直しは重複として数え、多い順に出す', () => {
	const efficiency = contextEfficiency([
		read(1, 'u1', '/w/a.ts'),
		read(2, 'u2', '/w/a.ts'),
		read(3, 'u3', '/w/a.ts'),
		read(4, 'u4', '/w/b.ts')
	]);
	assert.deepStrictEqual([efficiency.totalReads, efficiency.rereads, efficiency.score], [4, 2, 50]);
	assert.deepStrictEqual(efficiency.worst, [{ path: '/w/a.ts', reads: 3 }]);
	assert.ok(describeEfficiency(efficiency).includes('2 回の読み直し'));
});

test('読み込みが無いときは 0% ではなく満点（減点しようがない）', () => {
	const efficiency = contextEfficiency([]);
	assert.strictEqual(efficiency.score, 100);
	assert.strictEqual(describeEfficiency(efficiency), 'まだ読み込みがありません');
});
