import * as assert from 'assert';
import { test } from 'node:test';
import { parseInstalled } from '../core/plugins';

test('読めないものは空', () => {
	assert.deepStrictEqual(parseInstalled('{'), []);
});
