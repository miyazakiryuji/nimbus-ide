/**
 * コードオーナーの割り出し。
 *
 * **最後に一致した規則が勝つ**（GitHub の仕様）。ここを取り違えると、
 * 別の人にレビューを投げてしまう。
 *
 * 守っている修正（T-274）: T-221
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	describeOwners,
	ownersFor,
	parseCodeowners,
	renderMentionBlock,
	summarizeOwners
} from '../core/codeowners';

const CODEOWNERS = [
	'# 既定の持ち主',
	'*       @team/core',
	'',
	'/docs/  @team/docs @alice',
	'*.dart  @bob   # Flutter は bob',
	'/lib/ui/**  @carol'
].join('\n');

test('コメントと空行を落として読む', () => {
	assert.deepStrictEqual(parseCodeowners(CODEOWNERS), [
		{ pattern: '*', owners: ['@team/core'] },
		{ pattern: '/docs/', owners: ['@team/docs', '@alice'] },
		{ pattern: '*.dart', owners: ['@bob'] },
		{ pattern: '/lib/ui/**', owners: ['@carol'] }
	]);
});

test('最後に一致した規則が勝つ', () => {
	const rules = parseCodeowners(CODEOWNERS);
	assert.deepStrictEqual(ownersFor('src/a.ts', rules), ['@team/core']);
	assert.deepStrictEqual(ownersFor('docs/readme.md', rules), ['@team/docs', '@alice']);
	assert.deepStrictEqual(ownersFor('lib/model.dart', rules), ['@bob']);
	assert.deepStrictEqual(ownersFor('lib/ui/button.dart', rules), ['@carol']);
});

test('当たらなければ持ち主なし', () => {
	assert.deepStrictEqual(ownersFor('src/a.ts', []), []);
});

test('持ち主ごとにまとめ、持ち主のいないファイルも数える', () => {
	const summary = summarizeOwners(
		['lib/ui/a.dart', 'lib/ui/b.dart', 'docs/x.md'],
		parseCodeowners('/lib/ui/** @carol')
	);
	assert.deepStrictEqual(summary, {
		owners: [{ owner: '@carol', files: ['lib/ui/a.dart', 'lib/ui/b.dart'] }],
		unowned: ['docs/x.md']
	});
	assert.strictEqual(
		describeOwners(summary),
		['レビューを頼む相手 1 人', '  @carol: 2 ファイル', '  （持ち主なし: 1 ファイル）'].join('\n')
	);
});

test('誰も当たらなければ、そう言う', () => {
	assert.strictEqual(
		describeOwners(summarizeOwners(['src/a.ts'], [])),
		'触ったファイルに持ち主はいません（CODEOWNERS に一致しません）。'
	);
});

test('貼れる形は、ファイルを 5 件までに切る', () => {
	const files = Array.from({ length: 7 }, (_, index) => `lib/ui/f${index}.dart`);
	const block = renderMentionBlock(summarizeOwners(files, parseCodeowners('/lib/ui/** @carol')));
	assert.ok(block.startsWith('レビューをお願いします（CODEOWNERS より）:'), block);
	assert.ok(block.includes('他 2 件'), block);
	assert.strictEqual(renderMentionBlock({ owners: [] }), '');
});
