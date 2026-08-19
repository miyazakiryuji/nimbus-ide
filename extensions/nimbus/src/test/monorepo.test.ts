/**
 * モノレポのスコープ切り替え。
 *
 * 同じディレクトリに複数のマニフェストが並ぶ構成（Flutter の `pubspec.yaml` と
 * `build.gradle`）で、同じパッケージが 2 回出ないことを固定する。
 *
 * 守っている修正（T-274）: T-078
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildScopeNote, describeScope, findPackages } from '../core/monorepo';

test('マニフェストの場所からパッケージの根を割り出す', () => {
	assert.deepStrictEqual(
		findPackages([
			'package.json',
			'packages/app/package.json',
			'packages/ui/package.json',
			'tools/gen/pyproject.toml'
		]),
		[
			{ path: '.', manifest: 'package.json' },
			{ path: 'packages/app', manifest: 'package.json' },
			{ path: 'packages/ui', manifest: 'package.json' },
			{ path: 'tools/gen', manifest: 'pyproject.toml' }
		]
	);
});

test('同じディレクトリに複数のマニフェストがあっても 1 つに畳む', () => {
	assert.deepStrictEqual(
		findPackages(['app/pubspec.yaml', 'app/build.gradle']),
		[{ path: 'app', manifest: 'pubspec.yaml' }]
	);
});

test('マニフェストでないファイルは無視する', () => {
	assert.deepStrictEqual(findPackages(['docs/readme.md', 'src/index.ts']), []);
});

test('いまの状態と、変えたときの説明を出す', () => {
	assert.strictEqual(describeScope(undefined), '作業対象: リポジトリ全体');
	assert.strictEqual(describeScope('/w/repo/packages/app'), '作業対象: /w/repo/packages/app');
	assert.ok(buildScopeNote('/w/a').includes('既に走っているセッションはそのままです'));
	assert.ok(buildScopeNote(undefined).startsWith('作業対象の絞り込みを解除しました。'));
});
