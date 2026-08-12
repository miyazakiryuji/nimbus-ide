/**
 * 環境の食い違い（T-205）の単体テスト。
 *
 * **パッチ違いで騒がない**、**どちらに合わせるかは言わない**を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { collectRequirements, compareEnvironment, lowerBound, renderEnvironment, sameEnough } from '../core/envCheck';

const files = [
	{ path: '.nvmrc', content: 'v24.18.0\n' },
	{ path: 'package.json', content: JSON.stringify({ engines: { node: '>=22.0.0', npm: '^10.1.0' } }) },
	{ path: 'pubspec.yaml', content: 'environment:\n  sdk: ">=3.4.0 <4.0.0"\n' },
	{ path: '.tool-versions', content: 'golang 1.22.3\n# コメント\n' }
];

test('求めている版を、書いてある場所ごとに集める', () => {
	assert.deepStrictEqual(
		collectRequirements(files).map((r) => `${r.tool}:${r.expected}`),
		['node:24.18.0', 'node:22.0.0', 'npm:10.1.0', 'dart:3.4.0', 'golang:1.22.3']
	);
});

test('制約から下限を取り出す', () => {
	assert.deepStrictEqual([lowerBound('>=3.4.0 <4.0.0'), lowerBound('^10.1.0'), lowerBound('なし')], [
		'3.4.0',
		'10.1.0',
		undefined
	]);
});

test('読めない package.json は黙って飛ばす', () => {
	assert.deepStrictEqual(collectRequirements([{ path: 'package.json', content: '{ 壊れている' }]), []);
});

test('パッチ違いでは騒がない（メジャーとマイナーまで見る）', () => {
	assert.deepStrictEqual([sameEnough('24.18.0', '24.18.3'), sameEnough('24.18.0', '24.19.0')], [true, false]);
});

test('入っていないものは missing にする', () => {
	const findings = compareEnvironment([{ tool: 'dart', expected: '3.4.0', source: 'x' }], {});
	assert.strictEqual(findings[0].状態, 'missing');
});

test('食い違いを mismatch にする', () => {
	const findings = compareEnvironment([{ tool: 'node', expected: '24.18.0', source: 'x' }], { node: 'v22.1.0' });
	assert.deepStrictEqual({ 状態: findings[0].状態, actual: findings[0].actual }, { 状態: 'mismatch', actual: '22.1.0' });
});

test('どちらに合わせるかは言わない', () => {
	const text = renderEnvironment(compareEnvironment([{ tool: 'node', expected: '24.0.0', source: 'x' }], { node: '22.0.0' }));
	assert.ok(text.includes('どちらに合わせるかは状況によります'));
});

test('記載が無ければ、どこを見ているかを書く', () => {
	assert.ok(renderEnvironment([]).includes('.nvmrc'));
});
