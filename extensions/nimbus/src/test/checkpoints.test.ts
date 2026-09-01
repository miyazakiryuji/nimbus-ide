/**
 * チェックポイントと MCP の単体テスト。
 *
 * 巻き戻しは**戻しすぎたときに取り返しがつかない**ので、
 * 「戻せない」「何も変わらない」をはっきり言えることを重点的に押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { NimbusEvent } from '../events';
import { buildCheckpoints, checkpointLabel, describeRewind, pairUserTurns, userTurnEvent } from '../core/checkpoints';
import { canReconnect, describeServer, sortServers, statusLabel, toolBadge, type McpServer } from '../core/mcp';

function checkpoint(timestamp: number, messageUuid: string, text: string): NimbusEvent {
	return { kind: 'checkpoint', sessionId: 's1', timestamp, messageUuid, text };
}

test('チェックポイントは新しい順に並び、番号は古い順に振る', () => {
	const checkpoints = buildCheckpoints([
		checkpoint(1, 'a', '最初の指示'),
		checkpoint(2, 'b', '次の指示'),
		checkpoint(3, 'c', '最後の指示')
	]);
	assert.deepStrictEqual(
		checkpoints.map((c) => [c.index, c.messageUuid]),
		[
			[3, 'c'],
			[2, 'b'],
			[1, 'a']
		]
	);
});

test('同じメッセージが二度流れても候補は増えない', () => {
	const checkpoints = buildCheckpoints([checkpoint(1, 'a', '指示'), checkpoint(2, 'a', '指示')]);
	assert.strictEqual(checkpoints.length, 1);
});

test('チェックポイント以外のイベントは候補にしない', () => {
	const events: NimbusEvent[] = [
		{ kind: 'user-text', sessionId: 's1', timestamp: 1, text: 'これは表示用' },
		checkpoint(2, 'a', '指示')
	];
	assert.deepStrictEqual(
		buildCheckpoints(events).map((c) => c.messageUuid),
		['a']
	);
});

test('一覧のラベルは長い指示を畳む', () => {
	assert.strictEqual(checkpointLabel({ messageUuid: 'a', text: ' 複数\n行の  指示 ', at: 1, index: 1 }), '複数 行の 指示');
	const long = checkpointLabel({ messageUuid: 'a', text: 'x'.repeat(200), at: 1, index: 1 });
	assert.strictEqual(long.length, 61);
	assert.ok(long.endsWith('…'));
});

test('巻き戻しの結果は「戻せない」「何も変わらない」をはっきり言う', () => {
	assert.strictEqual(describeRewind({ canRewind: false, error: '対象が見つかりません' }), '巻き戻せません: 対象が見つかりません');
	assert.strictEqual(describeRewind({ canRewind: false }), '巻き戻せません');
	/*
	 * T-364 — **「会話だけが戻ります」と言わない。** 巻き戻しの実体は SDK の `rewindFiles()` で、
	 * 戻すのはファイルだけ。会話を切り詰める処理は無いのに、それを約束していた。
	 */
	assert.strictEqual(
		describeRewind({ canRewind: true, filesChanged: [] }),
		'戻せるファイルの変更はありません（会話はそのまま残ります）'
	);
	assert.strictEqual(
		describeRewind({ canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 10, deletions: 4 }),
		'2 ファイル · +10 / -4'
	);
});

// --- MCP（T-029 / T-042） ---

const server = (name: string, status: McpServer['status'], extra: Partial<McpServer> = {}): McpServer => ({
	name,
	status,
	...extra
});

test('困っているサーバーを先に見せる', () => {
	const sorted = sortServers([
		server('z-connected', 'connected'),
		server('a-disabled', 'disabled'),
		server('m-failed', 'failed'),
		server('b-auth', 'needs-auth')
	]);
	assert.deepStrictEqual(
		sorted.map((s) => s.name),
		['m-failed', 'b-auth', 'z-connected', 'a-disabled']
	);
});

test('状態は利用者の言葉にする', () => {
	assert.deepStrictEqual(
		(['connected', 'failed', 'needs-auth', 'pending', 'disabled'] as const).map(statusLabel),
		['接続済み', '接続失敗', '認証が必要', '接続中', '無効']
	);
});

test('押しても何も起きないボタンは出さない', () => {
	assert.deepStrictEqual(
		(['failed', 'needs-auth', 'connected', 'pending', 'disabled'] as const).map(canReconnect),
		[true, true, true, false, false]
	);
});

test('サーバーの 1 行まとめには、ツール数とエラーを載せる', () => {
	assert.strictEqual(
		describeServer(server('x', 'connected', { scope: 'project', tools: [{ name: 't1' }, { name: 't2' }] })),
		'接続済み · project · ツール 2'
	);
	assert.strictEqual(describeServer(server('x', 'failed', { error: 'ENOENT' })), '接続失敗 · ENOENT');
});

test('破壊的なツールは使う前に分かる', () => {
	assert.deepStrictEqual(
		[toolBadge({ destructive: true }), toolBadge({ readOnly: true }), toolBadge(), toolBadge({})],
		['破壊的', '読み取り専用', '', '']
	);
});

/**
 * T-363 — 画面の発言と巻き戻し先を**並び順で**結ぶ。
 *
 * **本文で突き合わせない。** 表示用の `user-text` と SDK 由来の `checkpoint` は別イベントなので、
 * 同じ文を 2 回送ると本文では見分けが付かない（Codex の指摘）。ここではそれを固定する。
 */
test('同じ文を 2 回送っても、発言と戻り先が取り違わらない（T-363）', () => {
	const at = 1;
	const events = [
		{ kind: 'user-text', text: '直して', timestamp: at, sessionId: 's' },
		{ kind: 'checkpoint', messageUuid: 'uuid-1', text: '直して', timestamp: at, sessionId: 's' },
		{ kind: 'assistant-text', text: 'はい', timestamp: at, sessionId: 's' },
		// **まったく同じ本文**をもう一度送る
		{ kind: 'user-text', text: '直して', timestamp: at, sessionId: 's' },
		{ kind: 'checkpoint', messageUuid: 'uuid-2', text: '直して', timestamp: at, sessionId: 's' }
	] as unknown as Parameters<typeof pairUserTurns>[0];
	assert.deepStrictEqual(pairUserTurns(events), [
		{ turnIndex: 0, text: '直して', messageUuid: 'uuid-1' },
		{ turnIndex: 1, text: '直して', messageUuid: 'uuid-2' }
	]);
});

test('戻り先が残っていない発言は、落とさず messageUuid 無しで返す（T-363）', () => {
	/*
	 * 鉛筆を隠すだけでなく「この発言は戻る先が残っていません」と**理由を言える**ようにするため、
	 * 落とさずに返す。落とすと画面の並び順とずれて、別の発言を編集してしまう
	 */
	const events = [
		{ kind: 'user-text', text: '古い指示', timestamp: 1, sessionId: 's' },
		{ kind: 'user-text', text: '新しい指示', timestamp: 2, sessionId: 's' },
		{ kind: 'checkpoint', messageUuid: 'uuid-2', text: '新しい指示', timestamp: 2, sessionId: 's' }
	] as unknown as Parameters<typeof pairUserTurns>[0];
	assert.deepStrictEqual(pairUserTurns(events), [
		{ turnIndex: 0, text: '古い指示' },
		{ turnIndex: 1, text: '新しい指示', messageUuid: 'uuid-2' }
	]);
});

/**
 * T-367 ① — 直すときには本文以外も要る。
 *
 * **そのとき走らせていたモデル**（会話の途中で `setModel()` できるので、いまのモデルとは
 * 限らない）と、**付けていた添付の枚数**（実体は控えに載せていないので、付け直しを促すため）。
 * 数えかたは `pairUserTurns()` と同じ並びでなければならない — ずれると**別の発言のモデルへ
 * 戻してしまう**ので、同じ列で突き合わせて固定する。
 */
test('N 番目の発言そのものを引ける（モデルと添付の枚数を戻すため・T-367）', () => {
	const events = [
		{ kind: 'user-text', text: '一つ目', timestamp: 1, sessionId: 's', model: 'opus' },
		{ kind: 'assistant-text', text: 'はい', timestamp: 2, sessionId: 's' },
		{ kind: 'user-text', text: '二つ目', timestamp: 3, sessionId: 's', model: 'sonnet', attachmentCount: 2 }
	] as unknown as Parameters<typeof userTurnEvent>[0];

	assert.deepStrictEqual(
		[0, 1, 2].map((index) => {
			const event = userTurnEvent(events, index);
			return event && { text: event.text, model: event.model, attachmentCount: event.attachmentCount };
		}),
		[
			{ text: '一つ目', model: 'opus', attachmentCount: undefined },
			{ text: '二つ目', model: 'sonnet', attachmentCount: 2 },
			undefined
		]
	);
	// **並びは `pairUserTurns()` と揃っていること**（ずれると別の発言のモデルへ戻す）
	assert.deepStrictEqual(
		pairUserTurns(events).map((turn) => turn.text),
		[0, 1].map((index) => userTurnEvent(events, index)?.text)
	);
});
