/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import {
	commandFor,
	describeRow,
	mergePlugins,
	parseCatalog,
	parseEnabled,
	parseInstalled,
	stateOf,
	type PluginRow
} from '../core/plugins';

/** `installed_plugins.json`（version 2）の形 */
const INSTALLED = JSON.stringify({
	version: 2,
	plugins: {
		'writer@shop': [
			{ scope: 'user', version: '1.0.0', installedAt: '2026-01-01T00:00:00.000Z' },
			// 同じものが scope 違いで入っている。新しい方を採る
			{ scope: 'project', version: '2.0.0', installedAt: '2026-05-01T00:00:00.000Z' }
		],
		'linter@shop': [{ scope: 'user', version: '0.3.0', installedAt: '2026-02-01T00:00:00.000Z' }],
		'handmade@local': [{ scope: 'user', version: '0.1.0', installedAt: '2026-03-01T00:00:00.000Z' }]
	}
});

const SETTINGS = JSON.stringify({
	enabledPlugins: { 'writer@shop': true, 'linter@shop': false, 'ghost@shop': true },
	otherSetting: 'そのまま'
});

const CATALOG = JSON.stringify({
	plugins: [
		{ name: 'writer', description: '文章を直す', version: '2.0.0' },
		{ name: 'linter', description: '書き方を揃える' },
		{ name: 'unused', description: 'まだ入れていない' },
		{ notName: '壊れた行' }
	]
});

test('入っているものを読む。scope 違いは新しい方を採る', () => {
	assert.deepStrictEqual(parseInstalled(INSTALLED), [
		{ id: 'writer@shop', version: '2.0.0' },
		{ id: 'linter@shop', version: '0.3.0' },
		{ id: 'handmade@local', version: '0.1.0' }
	]);
});

test('有効・無効を読む。書かれていないものは足さない', () => {
	assert.deepStrictEqual([...parseEnabled(SETTINGS)], [
		['writer@shop', true],
		['linter@shop', false],
		['ghost@shop', true]
	]);
});

test('目録を読む。名前の無い行は飛ばす', () => {
	assert.deepStrictEqual(
		parseCatalog(CATALOG, 'shop').map((row) => [row.id, row.description]),
		[
			['writer@shop', '文章を直す'],
			['linter@shop', '書き方を揃える'],
			['unused@shop', 'まだ入れていない']
		]
	);
});

test('読めないものは空（落とさない）', () => {
	assert.deepStrictEqual([parseInstalled('{'), [...parseEnabled('{')], parseCatalog('{', 'shop')], [[], [], []]);
});

test('突き合わせると、目録に無いものも設定だけのものも残る', () => {
	const rows = mergePlugins(parseInstalled(INSTALLED), parseEnabled(SETTINGS), parseCatalog(CATALOG, 'shop'));
	assert.deepStrictEqual(
		rows.map((row) => [row.id, stateOf(row)]),
		[
			['writer@shop', 'enabled'],
			// 目録に無いが入っている（手で入れた・目録から消えた）
			['handmade@local', 'disabled'],
			['linter@shop', 'disabled'],
			// 設定にあるのに入っていない
			['ghost@shop', 'stale'],
			['unused@shop', 'not-installed']
		]
	);
});

test('「設定にあるのに入っていない」を「無効」と一緒にしない', () => {
	const stale: PluginRow = { id: 'ghost@shop', name: 'ghost', marketplace: 'shop', enabled: true, installed: false };
	assert.strictEqual(stateOf(stale), 'stale');
	// 有効にしようとするのではなく、入れ直しにいく
	assert.deepStrictEqual(commandFor(stale).args, ['plugin', 'install', 'ghost@shop']);
	assert.ok(commandFor(stale).description.includes('入っていません'));
});

test('押したときに走る指図は、いまの状態の逆', () => {
	const rows = mergePlugins(parseInstalled(INSTALLED), parseEnabled(SETTINGS), parseCatalog(CATALOG, 'shop'));
	assert.deepStrictEqual(
		rows.map((row) => commandFor(row).args[1]),
		['disable', 'enable', 'enable', 'install', 'install']
	);
});

test('一覧の行は、状態と出どころが分かる', () => {
	const [writer] = mergePlugins(parseInstalled(INSTALLED), parseEnabled(SETTINGS), parseCatalog(CATALOG, 'shop'));
	assert.deepStrictEqual(describeRow(writer), {
		label: '$(check) writer',
		detail: '有効 · shop · v2.0.0 · 文章を直す'
	});
});

test('入っているものを先に、有効なものを上に出す', () => {
	const rows = mergePlugins(parseInstalled(INSTALLED), parseEnabled(SETTINGS), parseCatalog(CATALOG, 'shop'));
	assert.deepStrictEqual(rows.map((row) => row.installed), [true, true, true, false, false]);
});
