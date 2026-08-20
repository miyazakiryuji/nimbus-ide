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
			['?', 'あなたの番', 'editorInfo-foreground'],
			['✓', '完了', 'testing-iconPassed'],
			['■', '中断', 'descriptionForeground'],
			['✕', 'エラー', 'list-errorForeground']
		]
	);
});
