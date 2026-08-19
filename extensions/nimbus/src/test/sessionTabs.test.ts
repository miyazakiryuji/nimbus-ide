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
import { buildTabs, tabStateOf, tabTitle } from '../core/sessionTabs';

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
