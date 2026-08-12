/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeEntry, installWarning, parseMarket, search, type MarketEntry } from '../core/market';

const entry = {
	id: 'flutter-kit',
	name: 'Flutter 一式',
	description: 'Flutter 開発のスキルとサブエージェント',
	url: 'https://example.invalid/flutter.json',
	author: 'nimbus-community',
	contains: { skills: 3, agents: 1 },
	tags: ['flutter', 'mobile'],
	updated: '2026-08-01'
};

const market = JSON.stringify({ name: 'みんなの一覧', entries: [entry] });

describe('market', () => {
	test('読めた一覧はそのまま使える', () => {
		assert.deepStrictEqual(parseMarket(market), { ok: true, market: { name: 'みんなの一覧', entries: [entry] } });
	});

	test('形が違うものは理由を言って断る', () => {
		assert.deepStrictEqual(
			['なにか', '[]', '{}', '{"name":"a"}', '{"name":"a","entries":{}}'].map((text) => parseMarket(text)),
			[
				{ ok: false, reason: 'JSON として読めません' },
				{ ok: false, reason: '一覧はオブジェクトである必要があります' },
				{ ok: false, reason: 'name がありません' },
				{ ok: false, reason: 'entries が配列ではありません' },
				{ ok: false, reason: 'entries が配列ではありません' }
			]
		);
	});

	test('足りない項目は、どこの何が足りないかまで言う', () => {
		const { author, ...noAuthor } = entry;
		void author;
		assert.deepStrictEqual(parseMarket(JSON.stringify({ name: 'a', entries: [noAuthor] })), {
			ok: false,
			reason: 'entries[0].author がありません'
		});
	});

	test('https 以外は通さない（一覧を差し替えるだけで任意の場所から入れられてしまう）', () => {
		for (const url of ['http://example.invalid/a.json', 'file:///tmp/a.json', 'ftp://x/a.json']) {
			assert.deepStrictEqual(parseMarket(JSON.stringify({ name: 'a', entries: [{ ...entry, url }] })), {
				ok: false,
				reason: `entries[0].url は https だけを受け付けます: ${url}`
			});
		}
	});

	test('id の重複を断る（どちらが入ったか分からなくなる）', () => {
		assert.deepStrictEqual(parseMarket(JSON.stringify({ name: 'a', entries: [entry, entry] })), {
			ok: false,
			reason: 'entries[1].id が重複しています: flutter-kit'
		});
	});

	test('多すぎる一覧を断る', () => {
		const many = Array.from({ length: 501 }, (_, i) => ({ ...entry, id: `e${i}` }));
		assert.deepStrictEqual(parseMarket(JSON.stringify({ name: 'a', entries: many })), {
			ok: false,
			reason: 'entries が多すぎます（500 件まで）'
		});
	});

	test('名前・説明・作者・タグのどれでも探せる', () => {
		const entries = [entry as MarketEntry];
		assert.deepStrictEqual(
			['flutter', 'サブエージェント', 'community', 'mobile', '', 'ない'].map((q) => search(entries, q).length),
			[1, 1, 1, 1, 1, 0]
		);
	});

	test('1 行に出どころと中身を必ず添える', () => {
		assert.strictEqual(describeEntry(entry), 'nimbus-community · スキル 3 / サブエージェント 1 · 2026-08-01');
		assert.strictEqual(
			describeEntry({ ...entry, contains: undefined, updated: undefined }),
			'nimbus-community · 中身の記載なし'
		);
	});

	test('入れる前に、設定が含まれうることを言う', () => {
		const warning = installWarning(entry);
		assert.deepStrictEqual(
			{
				names: warning.includes('Flutter 一式（nimbus-community）'),
				settings: warning.includes('settings.json'),
				approval: warning.includes('承認の方針'),
				source: warning.includes(entry.url)
			},
			{ names: true, settings: true, approval: true, source: true }
		);
	});
});
