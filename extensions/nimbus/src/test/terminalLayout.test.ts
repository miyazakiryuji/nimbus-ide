import * as assert from 'assert';
import { test } from 'node:test';
import { planPanes } from '../core/terminalLayout';

test('枚数を受け取る', () => {
	assert.ok(Array.isArray(planPanes(2)));
});
