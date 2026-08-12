/**
 * ローカル完結・集中モード・立て直し（T-077 / T-087 / T-088）の単体テスト。
 *
 * ローカル完結は「**何が止まらないか**」を言えることが要。
 * 「外に出ない」と思い込ませるのが一番危ない。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { localOnlyEffect, RECOVERY_LABEL, shouldNotify, suggestRecovery } from '../core/recovery';

test('ローカル完結は「止まらないもの」も必ず出す', () => {
	const effect = localOnlyEffect();
	assert.ok(effect.stopped.length > 0);
	assert.ok(effect.notStopped.length > 0, '止まらないものを出していない');
	// Claude 本体との通信は止まらない。ここを黙ると誤解する
	assert.ok(effect.notStopped.some((line) => line.includes('Claude 本体との通信')));
	assert.ok(effect.stopped.some((line) => line.includes('監査ログ')));
});

const base = { enabled: true, focusMode: false, onlyWhenUnfocused: true, windowFocused: false, isApproval: false };

test('集中モードは完了通知を黙らせる', () => {
	assert.deepStrictEqual(shouldNotify({ ...base, focusMode: true }), { notify: false, reason: 'focus-mode' });
});

test('集中モードでも承認待ちは通す（黙らせると作業が進まない）', () => {
	assert.deepStrictEqual(shouldNotify({ ...base, focusMode: true, isApproval: true }), { notify: true, reason: 'ok' });
});

test('通知を切っていれば、承認待ちでも出さない', () => {
	assert.deepStrictEqual(
		shouldNotify({ ...base, enabled: false, isApproval: true }),
		{ notify: false, reason: 'disabled' }
	);
});

test('ウィンドウが前面なら出さない（既定）', () => {
	assert.deepStrictEqual(shouldNotify({ ...base, windowFocused: true }), { notify: false, reason: 'window-focused' });
	// 設定で切れば前面でも出る
	assert.strictEqual(shouldNotify({ ...base, windowFocused: true, onlyWhenUnfocused: false }).notify, true);
});

test('詰まっていないときは提案しない', () => {
	const quiet = suggestRecovery({ recentToolErrors: 1, repeatedEditsOnSameFile: 2, testsFailing: false });
	assert.deepStrictEqual(quiet, { stuck: false, options: [] });
});

test('詰まりの見立てには理由を必ず添える', () => {
	const stuck = suggestRecovery({ recentToolErrors: 3, repeatedEditsOnSameFile: 1, testsFailing: false });
	assert.strictEqual(stuck.stuck, true);
	assert.ok(stuck.reason?.includes('3 回'));
});

test('理由が複数あれば全部並べる', () => {
	const stuck = suggestRecovery({ recentToolErrors: 5, repeatedEditsOnSameFile: 4, testsFailing: true });
	assert.ok(stuck.reason?.includes('ツールの失敗'));
	assert.ok(stuck.reason?.includes('同じファイル'));
	assert.ok(stuck.reason?.includes('テストが通っていません'));
});

test('選択肢の最後は必ず「このまま続ける」（提案が邪魔なときの逃げ道）', () => {
	const stuck = suggestRecovery({ recentToolErrors: 3, repeatedEditsOnSameFile: 0, testsFailing: false });
	assert.strictEqual(stuck.options[stuck.options.length - 1], 'continue');
	assert.deepStrictEqual(stuck.options, ['rewind', 'alternative', 'handover', 'continue']);
	assert.strictEqual(RECOVERY_LABEL.continue, 'このまま続ける');
});
