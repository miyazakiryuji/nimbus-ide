import * as assert from 'assert';
import { test } from 'node:test';
import { pickEngine } from '../core/voiceInput';

test('何も無ければ選ばない', () => {
	assert.strictEqual(pickEngine([]), undefined);
});
