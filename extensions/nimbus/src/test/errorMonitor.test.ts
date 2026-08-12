/**
 * エラー監視ツールとの連携（T-142）の単体テスト。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { asCount } from '../core/errorMonitor';

test('数として読めるものだけを数える（Sentry は件数を文字列で返す）', () => {
	assert.deepStrictEqual([asCount('4021'), asCount(12), asCount('x'), asCount(-1), asCount(undefined)], [4021, 12, undefined, undefined, undefined]);
});
