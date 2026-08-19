/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** 守っている修正（T-274）: T-125 */

import * as assert from 'assert';
import { test } from 'node:test';
import { diffSchemas, isDestructive, orderChanges, parseSchema, renderMigration } from '../core/schemaDiff';

const BEFORE = `
-- 利用者
CREATE TABLE users (
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  nickname TEXT,
  PRIMARY KEY (id)
);

CREATE TABLE sessions (
  id INTEGER NOT NULL,
  price DECIMAL(10, 2)
);
`;

const AFTER = `
CREATE TABLE users (
  id INTEGER NOT NULL,
  name VARCHAR(255) NOT NULL,
  email TEXT NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE audit (
  id INTEGER NOT NULL,
  at TEXT NOT NULL DEFAULT 'now'
);
`;

test('CREATE TABLE から表と列を読む', () => {
	assert.deepStrictEqual(parseSchema(BEFORE), [
		{
			name: 'users',
			columns: [
				{ name: 'id', type: 'INTEGER', notNull: true, defaultValue: undefined },
				{ name: 'name', type: 'TEXT', notNull: true, defaultValue: undefined },
				{ name: 'nickname', type: 'TEXT', notNull: false, defaultValue: undefined }
			]
		},
		{
			name: 'sessions',
			columns: [
				{ name: 'id', type: 'INTEGER', notNull: true, defaultValue: undefined },
				{ name: 'price', type: 'DECIMAL(10, 2)', notNull: false, defaultValue: undefined }
			]
		}
	]);
});

test('表の制約（PRIMARY KEY など）は列として数えない', () => {
	const [users] = parseSchema(BEFORE);
	assert.deepStrictEqual(
		users.columns.map((column) => column.name),
		['id', 'name', 'nickname']
	);
});

test('差分は 足す・型を変える・消す をすべて拾う', () => {
	const changes = diffSchemas(parseSchema(BEFORE), parseSchema(AFTER));
	assert.deepStrictEqual(
		changes.map((change) => `${change.kind} ${change.table}${change.column ? '.' + change.column : ''}`),
		[
			'change-type users.name',
			'add-column users.email',
			'add-table audit',
			'drop-column users.nickname',
			'drop-table sessions'
		]
	);
});

test('NOT NULL を既定値なしで足すと、既存の行があると失敗すると書く', () => {
	const changes = diffSchemas(parseSchema(BEFORE), parseSchema(AFTER));
	const email = changes.find((change) => change.column === 'email');
	assert.ok(email?.description.includes('既存の行があると失敗します'));

	// 既定値があれば、その注意は出さない
	const at = diffSchemas([], parseSchema(AFTER)).find((change) => change.table === 'audit');
	assert.ok(!at?.description.includes('失敗'));
});

test('流す順は 足す → 変える → 消す', () => {
	const ordered = orderChanges(diffSchemas(parseSchema(BEFORE), parseSchema(AFTER)));
	assert.deepStrictEqual(ordered.map((change) => change.kind), [
		'add-table',
		'add-column',
		'change-type',
		'drop-column',
		'drop-table'
	]);
});

test('消す変更と型の変更は「戻せない」に入る', () => {
	const changes = diffSchemas(parseSchema(BEFORE), parseSchema(AFTER));
	assert.deepStrictEqual(
		changes.filter(isDestructive).map((change) => change.kind),
		['change-type', 'drop-column', 'drop-table']
	);
});

test('差が無ければ、そう言う', () => {
	assert.ok(renderMigration([]).includes('スキーマに差はありませんでした'));
});

test('報告は 戻せない変更 を手順より先に出す', () => {
	const report = renderMigration(diffSchemas(parseSchema(BEFORE), parseSchema(AFTER)));
	assert.ok(report.indexOf('戻せない変更') < report.indexOf('## 手順'));
	assert.ok(report.includes('バックアップ'));
	assert.ok(report.includes('これで全部とは限りません'));
});

test('DECIMAL(10, 2) のカンマで列を割らない', () => {
	const [table] = parseSchema('CREATE TABLE t (\n a DECIMAL(10, 2),\n b TEXT\n);');
	assert.deepStrictEqual(table.columns.map((column) => column.name), ['a', 'b']);
});

test('NOT NULL の NOT を型として拾わない（ありもしない型変更が出る）', () => {
	const [table] = parseSchema('CREATE TABLE t (\n a INTEGER NOT NULL,\n b DOUBLE PRECISION NOT NULL\n);');
	assert.deepStrictEqual(table.columns.map((column) => column.type), ['INTEGER', 'DOUBLE PRECISION']);
	// 同じスキーマ同士に差は出ない
	assert.deepStrictEqual(diffSchemas(parseSchema(BEFORE), parseSchema(BEFORE)), []);
});

test('IF NOT EXISTS と引用符つきの表名も読む', () => {
	const tables = parseSchema('CREATE TABLE IF NOT EXISTS `orders` (\n id INTEGER\n);');
	assert.deepStrictEqual(tables.map((table) => table.name), ['orders']);
});
