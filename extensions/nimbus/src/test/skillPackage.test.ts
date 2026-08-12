import * as assert from 'assert';
import { test } from 'node:test';
import { planPackage } from '../core/skillPackage';

test('計画を返す', () => {
	assert.deepStrictEqual(planPackage(), { plugins: [] });
});
