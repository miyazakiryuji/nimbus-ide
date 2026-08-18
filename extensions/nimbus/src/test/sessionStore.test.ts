/**
 * セッション台帳の読み書き（T-247 / T-251 / T-252）の単体テスト。
 *
 * 一番大事なのは **2 つのウィンドウが同時に書いても、どちらの記録も消えない**こと。
 * 1 つの JSON に全部入れていたら、ここが壊れる（T-250 の監査ログと同じ壊れかた）。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import { resumeCandidates } from '../core/sessionRegistry';
import { SessionStore } from '../sessionStore';

function storeIn(dir: string, windowId: string, now: () => number): SessionStore {
	// 心拍は手で進めたいので、テスト中は回さない
	return new SessionStore(dir, { windowId, pid: 1, now, heartbeatMs: 60 * 60 * 1000 });
}

test('書いた記録は、別のインスタンス（＝別ウィンドウ）から読める', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	const now = 1_000_000;
	const writer = storeIn(dir, 'win-a', () => now);
	writer.upsert('s1', { cwd: '/w/app', status: 'running', claudeSessionId: 'c1', title: '直す' });
	await writer.flush();
	writer.dispose();

	const reader = storeIn(dir, 'win-b', () => now);
	const records = await reader.list({ fresh: true });
	reader.dispose();
	assert.deepStrictEqual(records, [
		{
			sessionId: 's1',
			status: 'running',
			cwd: '/w/app',
			createdAt: now,
			updatedAt: now,
			claudeSessionId: 'c1',
			// JSON に undefined は残らない。読み直した記録に model / totalCostUsd の鍵は無い
			title: '直す',
			owner: { windowId: 'win-a', pid: 1, heartbeatAt: now }
		}
	]);
});

test('2 つのウィンドウが同時に書いても、どちらの記録も消えない', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	const now = () => 1_000_000;
	const a = storeIn(dir, 'win-a', now);
	const b = storeIn(dir, 'win-b', now);
	for (let i = 0; i < 20; i++) {
		a.upsert(`a${i}`, { cwd: '/w/app', status: 'running' });
		b.upsert(`b${i}`, { cwd: '/w/app', status: 'running' });
	}
	await Promise.all([a.flush(), b.flush()]);
	const seen = (await a.list({ fresh: true })).map((r) => r.sessionId).sort();
	a.dispose();
	b.dispose();
	assert.strictEqual(seen.length, 40);
});

test('閉じるときに手放した記録は、開き直したときの「続きから」に出る', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	const now = 1_000_000;
	const closing = storeIn(dir, 'win-a', () => now);
	closing.upsert('s1', { cwd: '/w/app', status: 'awaiting-input', claudeSessionId: 'c1' });
	await closing.flush();
	// 手放す前は生きているので、候補には出ない
	const beforeRelease = resumeCandidates(await closing.list({ fresh: true }), { now });
	await closing.release();
	closing.dispose();

	const reopened = storeIn(dir, 'win-b', () => now);
	const candidates = resumeCandidates(await reopened.list({ fresh: true }), { now, cwd: '/w/app' });
	reopened.dispose();
	assert.deepStrictEqual(
		[beforeRelease.length, candidates.map((r) => [r.sessionId, r.claudeSessionId])],
		[0, [['s1', 'c1']]]
	);
});

test('掃除は、自分がいま持っている記録には手を出さない', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	let clock = 1_000_000;
	const old = storeIn(dir, 'win-old', () => clock);
	old.upsert('ancient', { cwd: '/w/app', status: 'awaiting-input' });
	await old.flush();
	old.dispose();

	clock += 30 * 24 * 60 * 60 * 1000;
	const current = storeIn(dir, 'win-new', () => clock);
	current.upsert('current', { cwd: '/w/app', status: 'running' });
	await current.flush();
	const removed = await current.sweep();
	const left = (await current.list({ fresh: true })).map((r) => r.sessionId);
	current.dispose();
	assert.deepStrictEqual([removed, left], [1, ['current']]);
});
