/**
 * 使い始めの「準備」（T-285）の単体テスト。
 *
 * ここが間違えると、**使い始めで詰まった人に間違った直しかたを見せる**ことになる。
 * とくに押さえるのは 2 つ ── 止めているものだけを止めていると数えること、
 * リモートに繋いでいるときに「手元に入れればよい」と読ませないこと。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { blockedCount, buildReadiness, isAllowedAction, isReady, summaryLabel } from '../core/readiness';

const ready = { executable: '/usr/local/bin/claude', hasFolder: true, trusted: true, apiKeySource: 'none' };

test('すべて揃っていれば止めない', () => {
	const checks = buildReadiness(ready);

	assert.deepStrictEqual(
		checks.map((check) => [check.id, check.state, check.detail]),
		[
			['executable', 'ok', '/usr/local/bin/claude'],
			['folder', 'ok', '開いています'],
			['trust', 'ok', 'このフォルダを信頼しています'],
			['auth', 'ok', 'サブスク利用（利用上限を消費）']
		]
	);
	assert.strictEqual(isReady(checks), true);
	assert.strictEqual(summaryLabel(checks), 'Nimbus');
});

test('Claude Code が無いときは、押せば直る手段を添えて止める', () => {
	const checks = buildReadiness({ ...ready, executable: undefined });
	const executable = checks.find((check) => check.id === 'executable');

	assert.strictEqual(executable?.state, 'blocked');
	assert.deepStrictEqual(
		executable?.actions.map((action) => action.command),
		['nimbus.locateClaude', 'nimbus.openClaudeInstall', 'nimbus.recheckSetup']
	);
	assert.strictEqual(isReady(checks), false);
});

test('リモートに繋いでいるときは、繋いだ先に要ると言う', () => {
	const checks = buildReadiness({ ...ready, executable: undefined, remoteLabel: 'SSH 接続先' });
	const detail = checks.find((check) => check.id === 'executable')?.detail ?? '';

	assert.ok(detail.includes('SSH 接続先'), detail);
	assert.ok(detail.includes('手元に入っていても使われません'), detail);
});

test('フォルダを開いていなければ、信頼は聞かない', () => {
	const checks = buildReadiness({ ...ready, hasFolder: false, trusted: false });

	assert.deepStrictEqual(
		checks.map((check) => check.id),
		['executable', 'folder', 'auth']
	);
	assert.strictEqual(blockedCount(checks), 1);
});

test('信頼していないフォルダは、画面が開けても止まっていると言う', () => {
	const checks = buildReadiness({ ...ready, trusted: false });
	const trust = checks.find((check) => check.id === 'trust');

	assert.strictEqual(trust?.state, 'blocked');
	assert.ok(trust?.detail.includes('送っても走りません'), trust?.detail);
});

test('課金モードは、動かすまで「未確認」で止めない', () => {
	const checks = buildReadiness({ ...ready, apiKeySource: undefined });
	const auth = checks.find((check) => check.id === 'auth');

	assert.strictEqual(auth?.state, 'unknown');
	assert.strictEqual(isReady(checks), true);
});

test('ステータスバーには、残り件数と先頭の項目を出す', () => {
	const checks = buildReadiness({ ...ready, executable: undefined, trusted: false });

	assert.strictEqual(summaryLabel(checks), 'Nimbus — 準備 2 件（Claude Code）');
});

test('画面のボタンから走らせてよいコマンドを絞る', () => {
	assert.deepStrictEqual(
		['nimbus.locateClaude', 'workbench.trust.manage', 'workbench.action.terminal.kill'].map(isAllowedAction),
		[true, true, false]
	);
});
