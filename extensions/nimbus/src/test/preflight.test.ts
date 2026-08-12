import * as assert from 'assert';
import { test } from 'node:test';
import { checklist } from '../core/preflight';

test('チェック項目を返す', () => {
	assert.ok(Array.isArray(checklist()));
});
