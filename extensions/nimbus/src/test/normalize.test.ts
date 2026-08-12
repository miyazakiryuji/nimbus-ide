/**
 * SDK のメッセージ → Nimbus イベントの正規化。
 * SDK の型変更の影響をここに閉じ込めているので、ここが崩れると画面と保存の両方が壊れる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { normalizeSdkMessage } from '../session/normalize';

const at = (): number => 1000;
const SID = 'nimbus-session';

test('init は接続の事実（モデル・cwd・課金の出所）を持ち出す', () => {
	const events = normalizeSdkMessage(
		{
			type: 'system',
			subtype: 'init',
			session_id: 'claude-1',
			claude_code_version: '1.2.3',
			model: 'claude-opus-5',
			cwd: '/work',
			permissionMode: 'default',
			apiKeySource: 'none',
			tools: ['Read'],
			mcp_servers: [{ name: 'srv', status: 'connected' }],
			plugins: [{ name: 'p', version: '1' }],
			skills: ['pptx'],
			slash_commands: ['/help'],
			agents: []
		} as never,
		SID,
		at
	);
	assert.strictEqual(events.length, 1);
	assert.deepStrictEqual(
		{ ...events[0] },
		{
			kind: 'session-init',
			sessionId: SID,
			timestamp: 1000,
			claudeSessionId: 'claude-1',
			claudeCodeVersion: '1.2.3',
			model: 'claude-opus-5',
			cwd: '/work',
			permissionMode: 'default',
			apiKeySource: 'none',
			tools: ['Read'],
			mcpServers: [{ name: 'srv', status: 'connected' }],
			plugins: [{ name: 'p', version: '1' }],
			skills: ['pptx'],
			slashCommands: ['/help'],
			agents: []
		}
	);
});

test('assistant の text / thinking / tool_use をそれぞれのイベントにする', () => {
	const events = normalizeSdkMessage(
		{
			type: 'assistant',
			parent_tool_use_id: null,
			message: {
				content: [
					{ type: 'text', text: 'こんにちは' },
					{ type: 'thinking', thinking: '考え中' },
					{ type: 'tool_use', id: 'tu-1', name: 'Read', input: { file_path: '/a' } }
				]
			}
		} as never,
		SID,
		at
	);
	assert.deepStrictEqual(events.map((e) => e.kind), ['assistant-text', 'assistant-thinking', 'tool-use']);
});

test('サブエージェント由来（parent_tool_use_id あり）は主線に流さない', () => {
	const events = normalizeSdkMessage(
		{ type: 'assistant', parent_tool_use_id: 'tu-1', message: { content: [{ type: 'text', text: 'x' }] } } as never,
		SID,
		at
	);
	assert.deepStrictEqual(events, []);
});

test('ツール結果は tool_use_id で紐づけ、長い出力は畳む', () => {
	const events = normalizeSdkMessage(
		{
			type: 'user',
			parent_tool_use_id: null,
			message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', is_error: false, content: 'x'.repeat(2000) }] }
		} as never,
		SID,
		at
	);
	assert.strictEqual(events.length, 1);
	const event = events[0] as { kind: string; toolUseId: string; isError: boolean; preview: string };
	assert.strictEqual(event.kind, 'tool-result');
	assert.strictEqual(event.toolUseId, 'tu-1');
	assert.strictEqual(event.isError, false);
	assert.ok(event.preview.length <= 500, `畳まれていない: ${event.preview.length}`);
});

test('再開時の履歴リプレイは再びイベントにしない（二重表示を防ぐ）', () => {
	const events = normalizeSdkMessage(
		{ type: 'user', isReplay: true, parent_tool_use_id: null, message: { content: [] } } as never,
		SID,
		at
	);
	assert.deepStrictEqual(events, []);
});

test('result はコストと使用量を持ち出す（成功時だけ本文も）', () => {
	const [event] = normalizeSdkMessage(
		{
			type: 'result',
			subtype: 'success',
			is_error: false,
			num_turns: 2,
			duration_ms: 1234,
			total_cost_usd: 0.5,
			usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
			result: 'できました'
		} as never,
		SID,
		at
	) as unknown as [{ kind: string; totalCostUsd?: number; usage?: Record<string, number>; resultText?: string }];
	assert.strictEqual(event.kind, 'turn-result');
	assert.strictEqual(event.totalCostUsd, 0.5);
	assert.strictEqual(event.usage?.inputTokens, 10);
	assert.strictEqual(event.usage?.cacheReadInputTokens, 5);
	assert.strictEqual(event.resultText, 'できました');
});

test('知らない種別は黙って捨てる（増えても壊れない）', () => {
	assert.deepStrictEqual(normalizeSdkMessage({ type: 'stream_event' } as never, SID, at), []);
});
