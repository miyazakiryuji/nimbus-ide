/**
 * セッション台帳の読み書き（T-247 / T-251 / T-252）の単体テスト。
 *
 * 一番大事なのは **2 つのウィンドウが同時に書いても、どちらの記録も消えない**こと。
 * 1 つの JSON に全部入れていたら、ここが壊れる（T-250 の監査ログと同じ壊れかた）。
 *
 *   node --test extensions/nimbus/out/test
 *
 * 守っている修正（T-274）: T-248
 */
import * as assert from 'assert';
import { mkdtempSync, writeFileSync } from 'fs';
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

test('自分が書いた直後でも、他のウィンドウの記録を見失わない', async () => {
	// 同期で参照する snapshot() が「自分の分だけ」に痩せると、
	// 板の枠計算（T-251）が他ウィンドウを数え落として上限を超える
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	const now = () => 1_000_000;
	const other = storeIn(dir, 'win-other', now);
	other.upsert('theirs', { cwd: '/w/app', status: 'running' });
	await other.flush();
	other.dispose();

	const mine = storeIn(dir, 'win-mine', now);
	await mine.list({ fresh: true });
	mine.upsert('mine', { cwd: '/w/app', status: 'running' });
	const seen = mine.snapshot().map((record) => record.sessionId).sort();
	mine.dispose();
	assert.deepStrictEqual(seen, ['mine', 'theirs']);
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

test('終わったセッションには心拍を打たない（持ち主がいる意味が無く、書き込みだけが増える）', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	let clock = 1_000_000;
	// 心拍を手で 1 回だけ回すために、間隔を短くして待つ代わりに flush を直接見る
	const store = new SessionStore(dir, { windowId: 'win-a', pid: 1, now: () => clock, heartbeatMs: 20 });
	store.upsert('done', { cwd: '/w/app', status: 'completed' });
	store.upsert('live', { cwd: '/w/app', status: 'running' });
	await store.flush();
	const before = (await store.list({ fresh: true })).map((r) => [r.sessionId, r.owner.heartbeatAt]);
	clock += 60_000;
	await new Promise((resolve) => setTimeout(resolve, 60));
	await store.flush();
	const after = new Map((await store.list({ fresh: true })).map((r) => [r.sessionId, r.owner.heartbeatAt]));
	store.dispose();
	assert.deepStrictEqual(
		[before.length, after.get('done'), after.get('live')],
		[2, 1_000_000, 1_060_000]
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

/**
 * T-347（敵対的試験 adv-01）— 台帳はプロセスの外にあり、別ウィンドウ・別バージョン・
 * 手編集が書きうる。**型が崩れた 1 本で、まともな記録まで見えなくなってはいけない。**
 *
 * 以前の関門は `parsed?.sessionId && parsed.owner` の**真偽**だけだったので、
 * `sessionId: 123` が素通りし、一覧を組む側の `record.sessionId.slice(0, 8)` が
 * TypeError を投げて、セッション一覧そのものが開かなくなっていた。
 */
test('型が崩れた記録は読み飛ばし、まともな記録だけを返す（T-347）', async () => {
	const dir = join(mkdtempSync(join(tmpdir(), 'nimbus-sessions-')), 'sessions');
	const now = 1_000_000;
	const writer = storeIn(dir, 'win-a', () => now);
	writer.upsert('good', { cwd: '/w/app', status: 'running', title: '無事な記録' });
	await writer.flush();

	const owner = { windowId: 'win-x', pid: 2, heartbeatAt: now };
	const poison: Record<string, string> = {
		'p1.json': JSON.stringify({ sessionId: 123, owner, cwd: '/w', status: 'running' }),
		'p2.json': JSON.stringify({ sessionId: 'p2', owner, cwd: '/w', totalCostUsd: 'ちょっと' }),
		'p3.json': JSON.stringify({ sessionId: 'p3', owner, cwd: { path: '/w' } }),
		'p4.json': JSON.stringify({ sessionId: 'p4', owner: [] }),
		'p5.json': '{"sessionId":"p5","owner":{',
		'p6.json': ''
	};
	for (const [name, body] of Object.entries(poison)) {
		writeFileSync(join(dir, name), body);
	}

	const listed = (await writer.list({ fresh: true })).map((record) => record.sessionId);
	writer.dispose();
	assert.deepStrictEqual(listed, ['good']);
});
