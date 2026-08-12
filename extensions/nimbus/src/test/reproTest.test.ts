/**
 * 再現手順の生成（T-143）の単体テスト。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { detectFramework } from '../core/reproTest';

test('テストの書き方をプロジェクトから決める', () => {
	assert.deepStrictEqual(
		[
			detectFramework(['pubspec.yaml'], ''),
			detectFramework(['package.json'], '{"devDependencies":{"vitest":"^1"}}'),
			detectFramework(['package.json'], '{"devDependencies":{"jest":"^29"}}'),
			detectFramework(['package.json'], '{}'),
			detectFramework([], '')
		],
		['dart', 'vitest', 'jest', 'node', undefined]
	);
});
