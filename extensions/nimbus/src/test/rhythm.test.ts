/**
 * 作業のリズム（T-089 / T-053）の単体テスト。
 *
 * **押しつけないこと**が芯。1 回言ったらしばらく黙る、承認待ちのときは待ちの話をしない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { compass, formatDuration, renderRhythm, suggest } from '../core/rhythm';

const MINUTE = 60 * 1000;
const base = { startedAt: 0, now: 30 * MINUTE, running: 0, pending: 0 };

test('短いうちは何も言わない', () => {
	assert.strictEqual(suggest(base).kind, 'none');
});

test('90 分続けたら、一度だけすすめる', () => {
	assert.strictEqual(suggest({ ...base, now: 95 * MINUTE }).kind, 'break');
});

test('一度すすめたら 45 分は黙る', () => {
	assert.deepStrictEqual(
		[
			suggest({ ...base, now: 95 * MINUTE, lastSuggestedAt: 90 * MINUTE }).kind,
			suggest({ ...base, now: 140 * MINUTE, lastSuggestedAt: 90 * MINUTE }).kind
		],
		['none', 'break']
	);
});

test('走っているものがあれば、待ち時間の使い道をすすめる', () => {
	assert.strictEqual(suggest({ ...base, running: 2 }).kind, 'fill-wait');
});

test('承認待ちがあるときは、待ちの話をしない（人の番なので）', () => {
	assert.strictEqual(suggest({ ...base, running: 2, pending: 1 }).kind, 'none');
});

test('休憩のほうが待ち時間より優先される', () => {
	assert.strictEqual(suggest({ ...base, now: 95 * MINUTE, running: 2 }).kind, 'break');
});

test('経過を読める形にする', () => {
	assert.deepStrictEqual([formatDuration(45 * MINUTE), formatDuration(150 * MINUTE)], ['45 分', '2 時間 30 分']);
});

test('承認待ちがあるときは、そちらを先にと書く', () => {
	assert.ok(renderRhythm({ ...base, pending: 3 }).includes('ここは人の番'));
});

// ───────── 待ち時間コンパス（T-336） ─────────

test('コンパス: 承認待ち → デバッグ → 区切る → 別作業 → 指示、の順で 1 つに決まる（T-336）', () => {
	assert.deepStrictEqual(
		[
			compass({ ...base, running: 2, failed: 1, pending: 1 }).label, // 承認が最優先
			compass({ ...base, running: 2, failed: 1 }).label, // 次に失敗
			compass({ ...base, now: 95 * MINUTE, running: 2 }).label, // 次に続けすぎ
			compass({ ...base, running: 2 }).label, // 待ちは仕事で埋める
			compass(base).label // 何も無ければ指示の番
		],
		['人の番', 'デバッグを見る', '区切る', '別作業へ', '人の番']
	);
});

test('コンパスは黙る時間に縛られない — 聞かれたらいつでも今の判定を返す（T-336）', () => {
	assert.strictEqual(
		compass({ ...base, running: 1, lastSuggestedAt: 29 * MINUTE }).kind,
		'switch-work'
	);
});

test('いまのようすの頭に、コンパスの判定が出る（T-336）', () => {
	assert.ok(renderRhythm({ ...base, running: 2 }).includes('**コンパス: 別作業へ**'));
});
