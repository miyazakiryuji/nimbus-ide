/**
 * 改善前後のベンチ比較（T-130）の単体テスト。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { median } from '../core/benchmark';

test('中央値を出す（偶数個は真ん中 2 つの平均）', () => {
	assert.deepStrictEqual([median([3, 1, 2]), median([4, 1, 3, 2])], [2, 2.5]);
});
