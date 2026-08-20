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
		tabs.map((tab) => [tab.sessionId, tab.title, tab.state, tab.symbol, tab.active]),
		[
			['a', 'ログインを直す', 'waiting-approval', '!', false],
			['b', 'b', 'running', '●', true],
			['c', 'c', 'error', '✕', false]
		]
	);
});

test('名前は 1 行に畳んで切り詰め、無ければ ID の頭を使う', () => {
	assert.deepStrictEqual(
		[tabTitle('  直す\nすぐ  ', 'abcdefgh1234'), tabTitle(undefined, 'abcdefgh1234'), tabTitle('あ'.repeat(40), 'x', 10)],
		['直す すぐ', 'abcdefgh', `${'あ'.repeat(9)}…`]
	);
});

test('状態は記号・丸・言葉・色の 4 つで同じことを言う（T-298）', () => {
	// **記号だけだと小さくて読み取れない**という声が出た。
	// 色覚の違い・モノクロのスクリーンショット・小さな字面のどれでも、
	// どれか 1 つは必ず読める形にしておく
	assert.deepStrictEqual(
		(['waiting-approval', 'running', 'asking', 'done', 'stopped', 'error'] as const).map((state) => {
			const look = lookOf(state);
			return [look.symbol, look.mark, look.label];
		}),
		[
			['!', '🟡', '許可待ち'],
			['●', '🔵', '作業中'],
			['?', '⚪', 'あなたの番'],
			['✓', '🟢', '完了'],
			['■', '⚫', '中断'],
			['✕', '🔴', 'エラー']
		]
	);
});
