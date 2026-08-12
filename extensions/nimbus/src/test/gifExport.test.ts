import * as assert from 'assert';
import { test } from 'node:test';
import { planCapture } from '../core/gifExport';

test('計画を返す', () => {
	assert.ok(typeof planCapture(1, 1).frames === 'number');
});
