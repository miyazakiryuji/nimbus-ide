/**
 * 裏取りモード（ライブラリのバージョンを添える）。
 *
 * 誤爆すると毎回関係ない行が付いて、指示が読みにくくなる。
 * **語として現れているものだけ**を拾うことを固定する。
 *
 * 守っている修正（T-274）: T-083
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildGroundingNote,
	mentionedDependencies,
	parseGoMod,
	parsePackageJson,
	parsePubspec
} from '../core/dependencies';

test('package.json の 3 種類の依存を拾い、重複は 1 回だけ', () => {
	const text = JSON.stringify({
		dependencies: { react: '^18.3.1', '@scope/button-kit': '1.0.0' },
		devDependencies: { react: '^18.0.0', vitest: '^2.0.0' }
	});
	assert.deepStrictEqual(parsePackageJson(text), [
		{ name: 'react', version: '^18.3.1' },
		{ name: '@scope/button-kit', version: '1.0.0' },
		{ name: 'vitest', version: '^2.0.0' }
	]);
	assert.deepStrictEqual(parsePackageJson('{ 壊れ'), []);
});

test('pubspec.yaml の依存を拾う（入れ子の sdk 指定は飛ばす）', () => {
	const text = [
		'name: app',
		'dependencies:',
		'  flutter:',
		'    sdk: flutter',
		'  provider: ^6.1.0',
		'dev_dependencies:',
		'  flutter_test:',
		'    sdk: flutter',
		'  mocktail: ^1.0.0',
		'flutter:',
		'  uses-material-design: true'
	].join('\n');
	assert.deepStrictEqual(parsePubspec(text), [
		{ name: 'provider', version: '^6.1.0' },
		{ name: 'mocktail', version: '^1.0.0' }
	]);
});

test('go.mod の require を拾う', () => {
	const text = ['module x', 'require (', '\tgithub.com/foo/bar v1.2.3', ')', 'require golang.org/x/net v0.1.0'].join('\n');
	assert.deepStrictEqual(parseGoMod(text), [
		{ name: 'github.com/foo/bar', version: 'v1.2.3' },
		{ name: 'golang.org/x/net', version: 'v0.1.0' }
	]);
});

const DEPS = [
	{ name: 'react', version: '^18.3.1' },
	{ name: '@scope/button-kit', version: '1.0.0' },
	{ name: 'ky', version: '^1.0.0' }
];

test('語として現れている名前だけを拾う（短すぎる名前は見ない）', () => {
	assert.deepStrictEqual(
		mentionedDependencies('react の useEffect を直して', DEPS).map((entry) => entry.name),
		['react']
	);
	assert.deepStrictEqual(mentionedDependencies('reactive な設計にして', DEPS), []);
	assert.deepStrictEqual(mentionedDependencies('ky を使う', DEPS), []);
});

test('スコープつきは短い名前（3 文字以上）でも当たる', () => {
	assert.deepStrictEqual(
		mentionedDependencies('button-kit の Button を直して', DEPS).map((entry) => entry.name),
		['@scope/button-kit']
	);
	assert.deepStrictEqual(
		mentionedDependencies('@scope/button-kit を更新', DEPS).map((entry) => entry.name),
		['@scope/button-kit']
	);
});

test('添える文はバージョンを名指しし、記憶で書かせない', () => {
	const note = buildGroundingNote([{ name: 'react', version: '^18.3.1' }]);
	assert.ok(note.includes('**記憶ではなく、このバージョンの API で書いてください**'), note);
	assert.ok(note.includes('- react: ^18.3.1'), note);
	assert.strictEqual(buildGroundingNote([]), '');
});
