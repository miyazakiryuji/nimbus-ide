/**
 * 依存のライセンス（T-076）の単体テスト。
 *
 * **迷ったら unknown に倒す**（permissive に倒すと「確認しなくていい」と読まれる）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { classifyAll, classifyLicense, renderLicenses, summarizeLicenses } from '../core/licenses';

test('よくあるライセンスを分類する', () => {
	assert.deepStrictEqual(
		['MIT', 'Apache-2.0', 'LGPL-3.0', 'GPL-3.0', 'AGPL-3.0', 'SSPL-1.0'].map(classifyLicense),
		['permissive', 'permissive', 'weak-copyleft', 'strong-copyleft', 'strong-copyleft', 'strong-copyleft']
	);
});

test('記載が無ければ unknown（permissive に倒さない）', () => {
	assert.deepStrictEqual([classifyLicense(undefined), classifyLicense('  '), classifyLicense('SEE LICENSE IN file')], [
		'unknown',
		'unknown',
		'unknown'
	]);
});

test('選べる表記（MIT OR GPL）は緩い方として扱う', () => {
	assert.strictEqual(classifyLicense('(MIT OR GPL-3.0)'), 'permissive');
});

test('分類して名前順に並べる', () => {
	assert.deepStrictEqual(
		classifyAll([{ name: 'b', license: 'MIT' }, { name: 'a' }]).map((p) => `${p.name}:${p.klass}`),
		['a:unknown', 'b:permissive']
	);
});

test('強いコピーレフトと分からないものだけを、その順で挙げる', () => {
	const packages = classifyAll([
		{ name: 'ok', license: 'MIT' },
		{ name: 'weak', license: 'MPL-2.0' },
		{ name: 'unknown-one' },
		{ name: 'strong', license: 'GPL-3.0' }
	]);
	assert.deepStrictEqual(summarizeLicenses(packages).flagged.map((p) => p.name), ['strong', 'unknown-one']);
});

test('件数を種類ごとに数える', () => {
	const summary = summarizeLicenses(classifyAll([{ name: 'a', license: 'MIT' }, { name: 'b', license: 'MIT' }]));
	assert.strictEqual(summary.counts.permissive, 2);
});

test('合法かどうかは判定していない、と書く', () => {
	const packages = classifyAll([{ name: 'a', license: 'MIT' }]);
	assert.ok(renderLicenses(packages, summarizeLicenses(packages)).includes('合法かどうかは判定していません'));
});

test('見つからなければ、その旨だけを書く', () => {
	assert.ok(renderLicenses([], summarizeLicenses([])).includes('見つかりませんでした'));
});
