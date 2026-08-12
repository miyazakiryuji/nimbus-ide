import * as assert from 'assert';
import { test } from 'node:test';
import { parseProfile } from '../core/cpuProfile';

test('読めないものは空', () => {
	assert.deepStrictEqual(parseProfile('{'), []);
});
