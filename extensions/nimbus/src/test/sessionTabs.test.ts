/**
 * セッションのタブ（T-269）の単体テスト。
 *
 * 要は 2 つ — **許可待ちがほかの状態に埋もれないこと**と、
 * **並びが状態で動かないこと**（押そうとした瞬間に入れ替わると押し間違える）。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import type { SessionSummary } from '../events';
import { buildTabs, lookOf, tabStateOf, tabTitle } from '../core/sessionTabs';

function summary(overrides: Partial<SessionSummary> & { sessionId: string }): SessionSummary {
	return {
		status: 'running',
		cwd: '/w/app',
		createdAt: 1,
		...overrides
	};
}

test('走っている最中でも、承認を待っていれば「許可待ち」にする', () => {
	assert.deepStrictEqual(
		[
			tabStateOf('running', true),
			tabStateOf('running', false),
			tabStateOf('awaiting-input', false),
			tabStateOf('interrupted', false),
			tabStateOf('completed', false),
			tabStateOf('error', false)
		],
		['waiting-approval', 'running', 'asking', 'stopped', 'done', 'error']
	);
});

test('タブの並びは始めた順で、状態では動かない', () => {
	const tabs = buildTabs(
		[
			summary({ sessionId: 'c', createdAt: 3, status: 'error' }),
			summary({ sessionId: 'a', createdAt: 1, status: 'completed' }),
			summary({ sessionId: 'b', createdAt: 2, status: 'running' })
		],
		{ activeSessionId: 'b', pendingSessionIds: new Set(['a']), titles: new Map([['a', 'ログインを直す']]) }
	);
	assert.deepStrictEqual(
		tabs.map((tab) => [tab.sessionId, tab.number, tab.title, tab.state, tab.symbol, tab.active]),
		[
			// 番号は始めた順。**幅が無くてもこれだけは残る**（T-301）
			['a', 1, 'ログインを直す', 'waiting-approval', '!', false],
			['b', 2, 'b', 'running', '●', true],
			['c', 3, 'c', 'error', '✕', false]
		]
	);
});

test('名前は意味の切れ目で切って短い見出しにする（T-301）', () => {
	// **先頭から数えて切らない。** 3 本並ぶと名前に使えるのは 30px ほどで、
	// 機械的に削るとどれも同じ書き出し（「この」「テストを」）になり見分けがつかない
	assert.deepStrictEqual(
		[
			tabTitle('ログイン画面のバリデーションを直して。今日中に', 'x'),
			tabTitle('テストを走らせて、落ちたら直して', 'x'),
			tabTitle('  直す\nすぐ  ', 'abcdefgh1234'),
			tabTitle(undefined, 'abcdefgh1234'),
			tabTitle('あ'.repeat(40), 'x', 10)
		],
		['ログイン画面のバリ…', 'テストを走らせて', '直す すぐ', 'abcdefgh', `${'あ'.repeat(9)}…`]
	);
});

test('状態は記号・言葉・テーマの色で言う（絵文字は使わない）（T-298 / T-302）', () => {
	// **記号だけだと小さくて読み取れない**という声が出たので言葉と色を添える。
	// ただし**絵文字は使わない**（T-302）— テーマの色に従わず、他がすべて SVG なので
	// そこだけ質感が変わる。色つきの印は webview がテーマトークンで塗る
	assert.deepStrictEqual(
		(['waiting-approval', 'running', 'asking', 'done', 'stopped', 'error'] as const).map((state) => {
			const look = lookOf(state);
			return [look.symbol, look.label, look.color];
		}),
		[
			['!', '許可待ち', 'list-warningForeground'],
			['●', '作業中', 'progressBar-background'],
			// 「あなたの番」に記号は無し（T-316）。? はエラーの気配に読める・色と言葉で足りる
			['', 'あなたの番', 'editorInfo-foreground'],
			['✓', '完了', 'testing-iconPassed'],
			['■', '中断', 'descriptionForeground'],
			['✕', 'エラー', 'list-errorForeground']
		]
	);
});

test('下書き（まだ送っていないセッション）もタブに出す（T-303）', () => {
	// 「+」はセッションを**足す**操作。下書きが出ないと、押した手応えが無い
	const tabs = buildTabs([summary({ sessionId: 'a', createdAt: 1, status: 'running' })], {
		activeSessionId: undefined,
		drafts: [{ id: 'draft-1', createdAt: 2 }],
		activeDraftId: 'draft-1',
		titles: new Map()
	});
	assert.deepStrictEqual(
		tabs.map((tab) => [tab.sessionId, tab.number, tab.title, tab.state, tab.active]),
		[
			['a', 1, 'a', 'running', false],
			// 下書きは始まった順のうしろ。中身が無いので「あなたの番」に倒す
			['draft-1', 2, '新しいセッション', 'asking', true]
		]
	);
});

test('ピン留めは先頭へ。ただし番号は動かさない（T-311）', () => {
	// 番号は席順ではなく**名札**。並び替えのたびに変わると「2 番のセッション」という会話が壊れる。
	// ピン留め同士・それ以外同士は始めた順のまま（安定ソート）
	const tabs = buildTabs(
		[
			summary({ sessionId: 'a', createdAt: 1, status: 'running' }),
			summary({ sessionId: 'b', createdAt: 2, status: 'running' }),
			summary({ sessionId: 'c', createdAt: 3, status: 'running' })
		],
		{ pinnedSessionIds: new Set(['c', 'b']), titles: new Map() }
	);
	assert.deepStrictEqual(
		tabs.map((tab) => [tab.sessionId, tab.number, tab.pinned]),
		[
			['b', 2, true],
			['c', 3, true],
			['a', 1, false]
		]
	);
});

test('利用者が付けた名前は、自動の見出しより優先する（T-313）', () => {
	// 空白だけの名前は「付けた」と数えない（自動の見出しへ戻る）
	const tabs = buildTabs(
		[
			summary({ sessionId: 'a', createdAt: 1, status: 'running' }),
			summary({ sessionId: 'b', createdAt: 2, status: 'running' })
		],
		{
			titles: new Map([
				['a', 'README を読んで直して'],
				['b', 'テストを走らせて']
			]),
			names: new Map([
				['a', 'リリース準備'],
				['b', '   ']
			])
		}
	);
	assert.deepStrictEqual(
		tabs.map((tab) => [tab.title, tab.full]),
		[
			// 名前が付いていても、指を置いたときの全文（最初に頼んだこと）は失わない
			['リリース準備', 'README を読んで直して'],
			['テストを走らせて', 'テストを走らせて']
		]
	);
});
