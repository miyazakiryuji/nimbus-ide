/**
 * セッションの残骸を見分ける（T-303）の単体テスト。
 *
 * ここが間違えると、**生きているセッションを残骸として消させる**か、
 * 逆に残骸を見落とす。とくに押さえるのは「持ち主が生きているかどうか」で仕分けが変わること。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { OWNER_TTL_MS, type SessionRecord } from '../core/sessionRegistry';
import { classify, inspect, needsAttention, overlaps, summaryLine } from '../core/sessionHealth';

const NOW = 1_000_000_000;

/** 心拍を「いつ書いたか」で作る。生きている＝ TTL 以内 */
function record(over: Partial<SessionRecord> & { sessionId: string; heartbeatAgo: number }): SessionRecord {
	const { heartbeatAgo, ...rest } = over;
	return {
		status: 'running',
		cwd: '/work/a',
		createdAt: NOW - 60_000,
		updatedAt: NOW - 60_000,
		owner: { windowId: `w-${over.sessionId}`, pid: 1, heartbeatAt: NOW - heartbeatAgo },
		...rest
	} as SessionRecord;
}

test('持ち主が生きているかで、走行中と残骸を分ける', () => {
	const alive = record({ sessionId: 'a', heartbeatAgo: 1_000 });
	const dead = record({ sessionId: 'b', heartbeatAgo: OWNER_TTL_MS + 1_000 });

	assert.deepStrictEqual([classify(alive, NOW), classify(dead, NOW)], ['running', 'orphaned']);
});

test('入力待ちでも、持ち主がいなければ残骸として数える', () => {
	const waiting = record({ sessionId: 'a', heartbeatAgo: 1_000, status: 'awaiting-input' });
	const abandoned = record({ sessionId: 'b', heartbeatAgo: OWNER_TTL_MS + 1, status: 'awaiting-input' });

	assert.deepStrictEqual([classify(waiting, NOW), classify(abandoned, NOW)], ['idle', 'orphaned']);
});

test('終わった記録は、持ち主がいなくても残骸にしない（復帰の候補として正常）', () => {
	const done = record({ sessionId: 'a', heartbeatAgo: OWNER_TTL_MS + 1, status: 'completed' });

	assert.strictEqual(classify(done, NOW), 'finished');
});

test('古くなったものは、残骸ではなく「忘れてよい」に倒す', () => {
	const old = record({
		sessionId: 'a',
		heartbeatAgo: OWNER_TTL_MS + 1,
		updatedAt: NOW - 8 * 24 * 60 * 60 * 1000
	});

	assert.strictEqual(classify(old, NOW), 'forgettable');
});

test('同じフォルダを生きた持ち主が 2 つ以上で持っていたら、重なりとして出す', () => {
	const records = [
		record({ sessionId: 'a', heartbeatAgo: 1_000, cwd: '/work/x' }),
		record({ sessionId: 'b', heartbeatAgo: 1_000, cwd: '/work/x' }),
		// 持ち主がいないものは重なりに数えない（誰も触っていない）
		record({ sessionId: 'c', heartbeatAgo: OWNER_TTL_MS + 1, cwd: '/work/x' }),
		record({ sessionId: 'd', heartbeatAgo: 1_000, cwd: '/work/y' })
	];

	assert.deepStrictEqual(overlaps(records, NOW), [{ cwd: '/work/x', sessionIds: ['a', 'b'] }]);
});

test('台帳ぜんぶを数えて、直すところがあるかを言う', () => {
	const records = [
		record({ sessionId: 'a', heartbeatAgo: 1_000 }),
		record({ sessionId: 'b', heartbeatAgo: OWNER_TTL_MS + 1 }),
		record({ sessionId: 'c', heartbeatAgo: OWNER_TTL_MS + 1, status: 'completed' })
	];
	const report = inspect(records, NOW);

	assert.deepStrictEqual(report.counts, { running: 1, idle: 0, finished: 1, orphaned: 1, forgettable: 0 });
	assert.deepStrictEqual(report.orphaned.map((r) => r.sessionId), ['b']);
	assert.strictEqual(needsAttention(report), true);
	assert.strictEqual(summaryLine(report), '3 件 — 走行中 1 / 待機 0 / 終了 1 / **持ち主なし 1**');
});

test('きれいなときは、直すところが無いと言う', () => {
	const report = inspect([record({ sessionId: 'a', heartbeatAgo: 1_000 })], NOW);

	assert.strictEqual(needsAttention(report), false);
	assert.strictEqual(summaryLine(report), '1 件 — 走行中 1 / 待機 0 / 終了 0');
});

test('記録が無ければ、空だと言う（数えられないのと区別する）', () => {
	assert.strictEqual(summaryLine(inspect([], NOW)), '台帳は空です（記録なし）。');
});
