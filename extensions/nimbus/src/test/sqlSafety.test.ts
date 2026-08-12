/**
 * SQL の確認（T-126 / T-127）の単体テスト。
 *
 * **「危ない」ではなく「何が起きるか」**を出すことを押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { classify, explainFor, inspect, isReadOnly, renderSqlReport, splitStatements } from '../core/sqlSafety';

test('コメントを落として文ごとに割る', () => {
	const sql = ['-- 説明', 'SELECT 1;', '/* 消す */', 'DELETE FROM users;'].join('\n');
	assert.deepStrictEqual(splitStatements(sql), ['SELECT 1', 'DELETE FROM users']);
});

test('読み取り・書き込み・スキーマを見分ける', () => {
	assert.deepStrictEqual(
		['SELECT 1', 'WITH x AS (SELECT 1) SELECT * FROM x', 'UPDATE t SET a=1', 'DROP TABLE t', 'VACUUM'].map(classify),
		['read', 'read', 'write', 'schema', 'unknown']
	);
});

test('WHERE の無い DELETE は「全行が消えます」と言う', () => {
	const result = inspect('DELETE FROM users');
	assert.deepStrictEqual(
		{ destructive: result.destructive, says: result.warnings[0].includes('全行が消えます') },
		{ destructive: true, says: true }
	);
});

test('WHERE があれば取り返しがつかないとはしない', () => {
	assert.strictEqual(inspect('DELETE FROM users WHERE id = 1').destructive, false);
});

test('DROP と TRUNCATE は、戻せないことまで書く', () => {
	assert.deepStrictEqual(
		[
			inspect('DROP TABLE users').warnings[0].includes('バックアップ'),
			inspect('TRUNCATE users').warnings[0].includes('ロールバックできません')
		],
		[true, true]
	);
});

test('列の削除も取り返しがつかない', () => {
	assert.strictEqual(inspect('ALTER TABLE users DROP COLUMN name').destructive, true);
});

test('読み取りだけかを判定する', () => {
	assert.deepStrictEqual(
		[isReadOnly([inspect('SELECT 1')]), isReadOnly([inspect('SELECT 1'), inspect('UPDATE t SET a=1 WHERE id=1')])],
		[true, false]
	);
});

test('実行計画の打ち方を 2 通り出す', () => {
	assert.deepStrictEqual(explainFor('SELECT 1'), ['EXPLAIN SELECT 1', 'EXPLAIN ANALYZE SELECT 1']);
});

test('読み取りだけなら、そのまま流してよいと書く', () => {
	assert.ok(renderSqlReport([inspect('SELECT 1')]).includes('そのまま流して問題ありません'));
});

test('取り返しがつかないものがあれば、先に件数を数えるよう書く', () => {
	const text = renderSqlReport([inspect('DELETE FROM users')]);
	assert.ok(text.includes('SELECT COUNT(*)'));
});

test('速さは静的に分からないと明記する', () => {
	assert.ok(renderSqlReport([inspect('SELECT 1')]).includes('静的には分かりません'));
});
