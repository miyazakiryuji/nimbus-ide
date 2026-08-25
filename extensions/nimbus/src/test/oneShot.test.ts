/**
 * 1 往復だけの問い合わせ（`oneShot.ts`・T-305 の裏方）。
 *
 * 守りたいのは「使い捨てが画面に出ない・残らない」こと — 走っている間だけ名簿
 * （`isOneShotSession`）に載り、終わったら必ず閉じて名簿からも消える。
 * イベントは自分のセッションのぶんだけを拾い、ツールを持たせない（permissionMode: 'plan'）。
 *
 * 守っている修正（T-323 の棚卸しで追加）: T-305 / T-309
 */
import * as assert from 'assert';
import { EventEmitter } from 'events';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { isOneShotSession, oneShot } from '../oneShot';
import type { SessionManager } from '../session/SessionManager';

interface CreatedInput {
	cwd: string;
	firstMessage: string;
	reuseSessionId?: string;
	extraOptions?: Record<string, unknown>;
}

/** oneShot が使う 4 つの口（on / off / createSession / close）だけを持つ偽物 */
class FakeSessions extends EventEmitter {
	readonly created: CreatedInput[] = [];
	readonly closed: string[] = [];
	constructor(private readonly script: (fake: FakeSessions, input: CreatedInput) => void) {
		super();
	}
	async createSession(input: CreatedInput): Promise<string> {
		this.created.push(input);
		queueMicrotask(() => this.script(this, input));
		return input.reuseSessionId ?? '';
	}
	close(sessionId: string): void {
		this.closed.push(sessionId);
	}
	send(event: NimbusEvent): void {
		this.emit('event', event);
	}
}

function textEvent(sessionId: string, text: string): NimbusEvent {
	return { kind: 'assistant-text', sessionId, timestamp: 1, text };
}

test('答えとコストを受け取り、閉じて名簿からも消す（T-305）', async () => {
	let listedWhileRunning = false;
	const fake = new FakeSessions((f, input) => {
		const id = input.reuseSessionId ?? '';
		listedWhileRunning = isOneShotSession(id);
		f.send(textEvent('someone-else', '無関係な行'));
		f.send(textEvent(id, '1 行目'));
		f.send(textEvent(id, '2 行目'));
		f.send({
			kind: 'turn-result', sessionId: id, timestamp: 2,
			subtype: 'success', isError: false, numTurns: 1, durationMs: 5, totalCostUsd: 0.12
		});
	});
	const result = await oneShot(fake as unknown as SessionManager, { cwd: '/tmp', prompt: 'こんにちは' });
	const id = fake.created[0].reuseSessionId ?? '';
	assert.deepStrictEqual(
		{
			result,
			listedWhileRunning,
			listedAfter: isOneShotSession(id),
			permissionMode: fake.created[0].extraOptions?.permissionMode,
			closed: fake.closed
		},
		{
			result: { text: '1 行目\n2 行目', costUsd: 0.12 },
			listedWhileRunning: true,
			listedAfter: false,
			permissionMode: 'plan',
			closed: [id]
		}
	);
});

test('セッションのエラーでも抜けて、必ず閉じる（T-305）', async () => {
	const fake = new FakeSessions((f, input) => {
		const id = input.reuseSessionId ?? '';
		f.send(textEvent(id, '途中まで'));
		f.send({ kind: 'session-error', sessionId: id, timestamp: 2, message: '落ちた' });
	});
	const result = await oneShot(fake as unknown as SessionManager, { cwd: '/tmp', prompt: 'p' });
	assert.deepStrictEqual(
		{ result, closed: fake.closed.length },
		{ result: { text: '途中まで', costUsd: undefined }, closed: 1 }
	);
});

test('時間切れなら空の答えで戻り、それでも閉じる（T-305）', async () => {
	const fake = new FakeSessions(() => { /* 何も返さない */ });
	const result = await oneShot(fake as unknown as SessionManager, { cwd: '/tmp', prompt: 'p', timeoutMs: 30 });
	assert.deepStrictEqual(
		{ result, closed: fake.closed.length },
		{ result: { text: '', costUsd: undefined }, closed: 1 }
	);
});
