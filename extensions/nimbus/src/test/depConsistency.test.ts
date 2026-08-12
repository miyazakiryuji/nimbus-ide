/**
 * 依存の食い違い（T-198）の単体テスト。
 *
 * 誤検知が出ると「また出てる」で無視されるので、**寄せて比べる**ところを押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { checkConsistency, parsePodfileLock, parsePubspecDeps, renderConsistency } from '../core/depConsistency';

const pubspec = [
	'name: app',
	'dependencies:',
	'  flutter:',
	'    sdk: flutter',
	'  http: ^1.2.0',
	'  url_launcher: ^6.0.0',
	'dev_dependencies:',
	'  flutter_test:',
	'    sdk: flutter',
	'  build_runner: ^2.4.0',
	'flutter:',
	'  uses-material-design: true'
].join('\n');

const podfileLock = ['PODS:', '  - Flutter (1.0.0)', '  - url_launcher_ios (0.0.1):', '    - Flutter', '', 'DEPENDENCIES:'].join('\n');

test('pubspec の依存を拾う（sdk: flutter は数えない）', () => {
	assert.deepStrictEqual(parsePubspecDeps(pubspec), ['http', 'url_launcher', 'flutter_test', 'build_runner']);
});

test('Podfile.lock の PODS を拾う（版とサブスペックは落とす）', () => {
	assert.deepStrictEqual(parsePodfileLock(podfileLock), ['Flutter', 'url_launcher_ios']);
});

test('lock に無い依存を挙げ、次にやることを書く', () => {
	const findings = checkConsistency({ pubspec, pubspecLockNames: ['http'] });
	assert.deepStrictEqual(
		findings.map((f) => `${f.kind}:${f.name}`),
		['missing-in-lock:build_runner', 'missing-in-lock:flutter_test', 'missing-in-lock:url_launcher']
	);
	assert.ok(findings[0].hint.includes('flutter pub get'));
});

test('プラグイン名は寄せて比べる（url_launcher と url_launcher_ios）', () => {
	assert.deepStrictEqual(checkConsistency({ podfileLock, knownPlugins: ['url_launcher'] }), []);
});

test('Podfile.lock に無いプラグインを挙げる', () => {
	const findings = checkConsistency({ podfileLock, knownPlugins: ['camera'] });
	assert.deepStrictEqual(findings.map((f) => f.kind), ['stale-pods']);
	assert.ok(findings[0].hint.includes('pod install'));
});

test('材料が無ければ何も言わない', () => {
	assert.deepStrictEqual(checkConsistency({}), []);
});

test('食い違いが無ければ、その旨だけを書く', () => {
	assert.ok(renderConsistency([]).includes('見つかりませんでした'));
});
