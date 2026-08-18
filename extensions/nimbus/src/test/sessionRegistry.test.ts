/**
 * セッション台帳の判断（T-247 / T-251 / T-252 / T-253）の単体テスト。
 *
 * 要は 3 つ — **死んだ持ち主のセッションを走っていることにしない**、
 * **生きている持ち主のセッションを横取りしない**、**似た名前のフォルダを重なりと誤判定しない**。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { SessionStatus } from '../events';
import {
	admit,
	describeOverlap,
	forgettable,
	heldByOther,
	overlappingSessions,
	pathOverlap,
	resumeCandidates,
	type SessionRecord
} from '../core/sessionRegistry';

const NOW = 1_000_000;

function record(overrides: Partial<SessionRecord> & { sessionId: string }): SessionRecord {
	const status: SessionStatus = overrides.status ?? 'running';
	return {
		status,
		cwd: '/w/app',
		createdAt: NOW - 60_000,
		updatedAt: NOW - 1_000,
		claudeSessionId: `claude-${overrides.sessionId}`,
		owner: { windowId: 'win-a', pid: 100, heartbeatAt: NOW - 1_000 },
		...overrides
	};
}

test('上限は全ウィンドウ合わせて数える（別の窓の分も枠を使う）', () => {
	const records = [
		record({ sessionId: 'a' }),
		record({ sessionId: 'b', owner: { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 500 } })
	];
	assert.deepStrictEqual(admit(records, { limit: 2, windowId: 'win-a', now: NOW }), {
		allowed: false,
		running: 2,
		limit: 2,
		elsewhere: 1,
		reason: '同時に走らせる上限（2）に達しています（うち 1 件は別のウィンドウ）。どれかが終わってから始めてください'
	});
});

test('入力待ちと、持ち主が死んだセッションは枠を使わない', () => {
	const records = [
		record({ sessionId: 'idle', status: 'awaiting-input' }),
		record({ sessionId: 'dead', owner: { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 120_000 } })
	];
	assert.deepStrictEqual(admit(records, { limit: 1, windowId: 'win-a', now: NOW }), {
		allowed: true,
		running: 0,
		limit: 1,
		elsewhere: 0
	});
});

test('上限 0 は「上限なし」として通す', () => {
	const records = [record({ sessionId: 'a' }), record({ sessionId: 'b' })];
	assert.strictEqual(admit(records, { limit: 0, windowId: 'win-a', now: NOW }).allowed, true);
});

test('生きている持ち主のセッションは、他のウィンドウから触らせない', () => {
	const mine = record({ sessionId: 'a' });
	const theirs = record({ sessionId: 'b', owner: { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 500 } });
	const gone = record({ sessionId: 'c', owner: { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 120_000 } });
	assert.deepStrictEqual(
		[mine, theirs, gone].map((r) => heldByOther(r, 'win-a', NOW)),
		[false, true, false]
	);
});

test('「続きから」に出すのは、持ち主が居なくて・終わっていなくて・鍵があるものだけ', () => {
	const dead = { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 120_000 };
	const records = [
		record({ sessionId: 'alive' }),
		record({ sessionId: 'finished', status: 'completed', owner: dead }),
		record({ sessionId: 'no-key', claudeSessionId: undefined, owner: dead }),
		record({ sessionId: 'other-repo', cwd: '/w/another', owner: dead }),
		record({ sessionId: 'resumable', status: 'awaiting-input', owner: dead, updatedAt: NOW - 5_000 })
	];
	assert.deepStrictEqual(
		resumeCandidates(records, { now: NOW, cwd: '/w/app' }).map((r) => r.sessionId),
		['resumable']
	);
});

test('似た名前のフォルダを重なりと誤判定しない', () => {
	assert.deepStrictEqual(
		[
			pathOverlap('/w/app', '/w/app'),
			pathOverlap('/w/app', '/w/app/lib'),
			pathOverlap('/w/app/lib', '/w/app'),
			pathOverlap('/w/app', '/w/app2'),
			pathOverlap('/w/app/', '/w/app')
		],
		['same', 'contains', 'contained', undefined, 'same']
	);
});

test('同じ場所で動いている生きたセッションだけを、重なりとして知らせる', () => {
	const records = [
		record({ sessionId: 'self', cwd: '/w/app' }),
		record({ sessionId: 'live', cwd: '/w/app', owner: { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 500 } }),
		record({ sessionId: 'dead', cwd: '/w/app', owner: { windowId: 'win-c', pid: 300, heartbeatAt: NOW - 120_000 } }),
		record({ sessionId: 'elsewhere', cwd: '/w/other' })
	];
	const hits = overlappingSessions(records, {
		cwd: '/w/app',
		windowId: 'win-a',
		now: NOW,
		ignoreSessionId: 'self'
	});
	assert.deepStrictEqual(hits.map((hit) => [hit.record.sessionId, hit.overlap]), [['live', 'same']]);
	assert.ok(describeOverlap(hits)?.includes('worktree'));
});

test('持ち主がいないまま置き去りになった記録だけを掃除の対象にする', () => {
	const dead = { windowId: 'win-b', pid: 200, heartbeatAt: NOW - 120_000 };
	const records = [
		record({ sessionId: 'fresh', owner: dead, updatedAt: NOW - 60_000 }),
		record({ sessionId: 'old', owner: dead, updatedAt: NOW - 8 * 24 * 60 * 60 * 1000 }),
		record({ sessionId: 'alive', updatedAt: NOW - 8 * 24 * 60 * 60 * 1000 })
	];
	assert.deepStrictEqual(forgettable(records, NOW).map((r) => r.sessionId), ['old']);
});
