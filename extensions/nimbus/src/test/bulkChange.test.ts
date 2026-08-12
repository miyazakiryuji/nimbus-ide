/**
 * 大規模な一括変更の段取り。
 *
 * 要件は「**一度に全部やらせない**」の一点。
 * まとまりの切り方と、間にテストを挟ませる指示をここで固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { buildMigrationPrompt, describeMigration, groupByDirectory, planBatches } from '../core/bulkChange';

const FILES = [
	'lib/ui/a.dart',
	'lib/ui/b.dart',
	'lib/ui/c.dart',
	'lib/data/d.dart',
	'main.dart'
];

test('上位ディレクトリでまとめ、多い順に並べる', () => {
	assert.deepStrictEqual(groupByDirectory(FILES), [
		{ directory: 'lib/ui', files: ['lib/ui/a.dart', 'lib/ui/b.dart', 'lib/ui/c.dart'] },
		{ directory: '.', files: ['main.dart'] },
		{ directory: 'lib/data', files: ['lib/data/d.dart'] }
	]);
});

test('まとまりはレビューできる大きさに割る', () => {
	const batches = planBatches(FILES, 2);
	assert.deepStrictEqual(batches, [
		['lib/ui/a.dart', 'lib/ui/b.dart'],
		['lib/ui/c.dart'],
		['main.dart'],
		['lib/data/d.dart']
	]);
});

test('要約はファイル数・ディレクトリ数・回数を先に言う', () => {
	const summary = describeMigration({ target: 'provider', files: FILES });
	assert.ok(summary.startsWith('provider: 5 ファイル / 3 ディレクトリ / 3 回に分けて進めます'), summary);
	assert.ok(summary.includes('  lib/ui/ — 3 ファイル'), summary);
});

test('段取りは「一度に全部直さない」と「間にテスト」を必ず入れる', () => {
	const prompt = buildMigrationPrompt({ target: 'provider', files: FILES, note: 'Provider.of は context.watch へ' });
	assert.ok(prompt.includes('**一度に全部直さないでください。**'), prompt);
	assert.ok(prompt.includes('**直す → 型を確かめる → 関係するテストを走らせる**'), prompt);
	assert.ok(prompt.includes('1. lib/ui/a.dart, lib/ui/b.dart'), prompt);
	assert.ok(prompt.includes('Provider.of は context.watch へ'), prompt);
});

test('当たりが無ければ、そう言う。段取りも作らない', () => {
	assert.strictEqual(
		describeMigration({ target: 'nothing', files: [] }),
		'nothing を使っている箇所は見つかりませんでした。'
	);
	assert.strictEqual(buildMigrationPrompt({ target: 'nothing', files: [] }), '');
});
