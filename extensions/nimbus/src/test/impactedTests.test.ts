/**
 * 影響を受けるテストの選び方。
 *
 * 「関係するテストが無い変更」を黙って落とさないことが要件。
 * 落とすと「関係するテストは 0 件でした」が安心の材料になってしまう。
 *
 * 守っている修正（T-274）: T-180
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { describeImpacted, selectImpactedTests } from '../core/impactedTests';

const DEPENDENTS: Record<string, string[]> = {
	'/repo/src/a.ts': ['/repo/src/b.ts', '/repo/test/a.test.ts'],
	'/repo/src/lonely.ts': ['/repo/src/c.ts']
};

test('実装ファイルは、それを参照しているテストに置き換える', () => {
	assert.deepStrictEqual(
		selectImpactedTests(['/repo/src/a.ts'], (file) => DEPENDENTS[file] ?? []),
		{ files: ['/repo/test/a.test.ts'], uncovered: [] }
	);
});

test('変更されたテストは、それ自体を走らせる', () => {
	assert.deepStrictEqual(
		selectImpactedTests(['/repo/test/direct.test.ts'], () => []),
		{ files: ['/repo/test/direct.test.ts'], uncovered: [] }
	);
});

test('テストが見つからない変更は uncovered に残す（黙って落とさない）', () => {
	assert.deepStrictEqual(
		selectImpactedTests(['/repo/src/lonely.ts'], (file) => DEPENDENTS[file] ?? []),
		{ files: [], uncovered: ['/repo/src/lonely.ts'] }
	);
});

test('同じテストが複数の変更から来ても 1 回だけ', () => {
	const dependents = (): string[] => ['/repo/test/shared.test.ts'];
	assert.deepStrictEqual(
		selectImpactedTests(['/repo/src/a.ts', '/repo/src/b.ts'], dependents).files,
		['/repo/test/shared.test.ts']
	);
});

test('説明は件数から始め、テストの無い変更も添える', () => {
	const impacted = { files: ['/repo/test/a.test.ts'], uncovered: ['/repo/src/lonely.ts'] };
	assert.strictEqual(
		describeImpacted(impacted, (file) => file.replace('/repo/', '')),
		['関係するテスト 1 件', '  test/a.test.ts', '（テストが見つからなかった変更: src/lonely.ts）'].join('\n')
	);
	assert.strictEqual(
		describeImpacted({ files: [], uncovered: [] }, (file) => file),
		'変更に関係するテストは見つかりませんでした。'
	);
});
