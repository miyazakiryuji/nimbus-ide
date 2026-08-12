import * as assert from 'assert';
import { test } from 'node:test';
import { parseSchema } from '../core/schemaDiff';

test('スキーマが空なら表は無い', () => {
	assert.deepStrictEqual(parseSchema(''), []);
});
