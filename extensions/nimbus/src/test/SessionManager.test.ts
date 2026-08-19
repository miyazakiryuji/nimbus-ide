/**
 * セッションの生成・送信・終了。
 *
 * `query()` を差し替えられる作りにしてあるので、実際の Claude を呼ばずに検証できる。
 * ここで守りたいのは「終わったセッションに送らせない」「コストを巻き戻さない」
 * 「終了時に入力を必ず閉じる（CLI のプロセスを残さない）」の 3 つ。
 *
 * 守っている修正（T-274）: T-018 / T-027 / T-037
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { SessionManager } from '../session/SessionManager';
import type { NimbusEvent } from '../events';

/** SDK の query() の代役。渡したメッセージを順に流し、prompt の消費もできる */
function fakeQuery(messages: unknown[], options?: { onInterrupt?: () => void }) {
	return ((args: { prompt: AsyncIterable<unknown> }) => {
		const handle = {
			async *[Symbol.asyncIterator]() {
				for (const message of messages) {
					yield message;
				}
				// prompt を読み切るまで待つ（実物と同じく、閉じられるまで生きている）
				for await (const _ of args.prompt) {
					void _;
				}
			},
			interrupt: async () => {
				options?.onInterrupt?.();
			}
		};
		return handle;
	}) as never;
}

const initMessage = {
	type: 'system',
	subtype: 'init',
	session_id: 'claude-1',
	claude_code_version: '1.0.0',
	model: 'claude-opus-5',
	cwd: '/work',
	permissionMode: 'default',
	apiKeySource: 'none',
	tools: [],
	mcp_servers: [],
	plugins: [],
	skills: [],
	slash_commands: []
};

const resultMessage = (cost: number) => ({
	type: 'result',
	subtype: 'success',
	is_error: false,
	num_turns: 1,
	duration_ms: 10,
	total_cost_usd: cost,
	usage: { input_tokens: 1, output_tokens: 1 },
	result: 'ok'
});

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (check()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error('期待した状態にならなかった');
}

test('最初のメッセージは user-text として記録され、状態が進む', async () => {
	const sessions = new SessionManager(fakeQuery([initMessage, resultMessage(0.1)]));
	const events: NimbusEvent[] = [];
	sessions.on('event', (e: NimbusEvent) => events.push(e));

	const id = await sessions.createSession({ cwd: '/work', firstMessage: 'やって' });
	await waitFor(() => sessions.get(id)?.status === 'awaiting-input');

	assert.ok(events.some((e) => e.kind === 'user-text' && e.text === 'やって'));
	assert.ok(events.some((e) => e.kind === 'session-init'));
	assert.strictEqual(sessions.get(id)?.totalCostUsd, 0.1);
	sessions.closeAll();
});

test('同じ ID で二重に作らせない', async () => {
	const sessions = new SessionManager(fakeQuery([initMessage]));
	const id = await sessions.createSession({ cwd: '/work', reuseSessionId: 'fixed' });
	await assert.rejects(() => sessions.createSession({ cwd: '/work', reuseSessionId: id }), /already active/);
	sessions.closeAll();
});

test('終わったセッションへの送信は黙殺せずエラーにする', async () => {
	const sessions = new SessionManager(fakeQuery([initMessage, resultMessage(0)]));
	const id = await sessions.createSession({ cwd: '/work', firstMessage: 'x' });
	await waitFor(() => sessions.get(id)?.status === 'awaiting-input');

	sessions.close(id); // 入力を閉じる＝もう受け付けない
	await waitFor(() => !sessions.isActive(id) || sessions.get(id)?.status !== 'running');
	assert.throws(() => sessions.sendMessage(id, 'まだ送れる？'), /not accepting input|Unknown session/);
});

test('コストは巻き戻さない（クラッシュ時の result はゼロを載せることがある）', async () => {
	const sessions = new SessionManager(fakeQuery([initMessage, resultMessage(0.5), resultMessage(0)]));
	const id = await sessions.createSession({ cwd: '/work', firstMessage: 'x' });
	await waitFor(() => (sessions.get(id)?.totalCostUsd ?? 0) > 0);
	await waitFor(() => sessions.get(id)?.status === 'awaiting-input');
	assert.strictEqual(sessions.get(id)?.totalCostUsd, 0.5);
	sessions.closeAll();
});

test('知らないセッションの操作はエラーになる', async () => {
	const sessions = new SessionManager(fakeQuery([]));
	assert.throws(() => sessions.sendMessage('無い', 'x'), /Unknown session/);
	assert.strictEqual(sessions.get('無い'), undefined);
	assert.strictEqual(sessions.isActive('無い'), false);
});

test('interrupt は SDK 側へ伝わる', async () => {
	let interrupted = false;
	const sessions = new SessionManager(fakeQuery([initMessage], { onInterrupt: () => (interrupted = true) }));
	const id = await sessions.createSession({ cwd: '/work', firstMessage: 'x' });
	await sessions.interrupt(id);
	assert.strictEqual(interrupted, true);
	sessions.closeAll();
});

test('closeAll で全セッションの入力を閉じる（CLI を残さない）', async () => {
	const sessions = new SessionManager(fakeQuery([initMessage]));
	const a = await sessions.createSession({ cwd: '/work' });
	const b = await sessions.createSession({ cwd: '/work' });
	sessions.closeAll();
	await waitFor(() => sessions.list().every((s) => s.status !== 'running'), 3000);
	assert.strictEqual(sessions.list().length, 2);
	assert.notStrictEqual(a, b);
});

test('optionsProvider の値が query に渡る（接続設定を効かせるため）', async () => {
	let seen: Record<string, unknown> | undefined;
	const spy = ((args: { options: Record<string, unknown>; prompt: AsyncIterable<unknown> }) => {
		seen = args.options;
		return {
			async *[Symbol.asyncIterator]() {
				for await (const _ of args.prompt) {
					void _;
				}
			},
			interrupt: async () => undefined
		};
	}) as never;
	const sessions = new SessionManager(spy, async () => ({ settingSources: [] }));
	await sessions.createSession({ cwd: '/work' });
	assert.deepStrictEqual(seen?.settingSources, []);
	assert.strictEqual(seen?.cwd, '/work');
	sessions.closeAll();
});
