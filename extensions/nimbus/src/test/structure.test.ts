/**
 * 重いところと層の逆流（T-136 / T-138）の単体テスト。
 *
 * 数字そのものより、**同じ物差しで比べられること**を確かめる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	findLayerViolations,
	importedModules,
	measureComplexity,
	rankComplexity,
	renderStructure
} from '../core/structure';

test('分岐・入れ子・行数を数える（コメントと空行は数えない）', () => {
	const content = [
		'// コメント',
		'',
		'function f(a) {',
		'  if (a && a.b) {',
		'    for (const x of a.b) {',
		'      return x;',
		'    }',
		'  }',
		'}'
	].join('\n');
	const m = measureComplexity('a.ts', content);
	assert.deepStrictEqual({ decisions: m.decisions, nesting: m.maxNesting, lines: m.lines }, {
		decisions: 3,
		nesting: 3,
		lines: 7
	});
});

test('分岐の多い順、同じなら入れ子の深い順に並べる', () => {
	const ranked = rankComplexity([
		{ path: 'simple.ts', content: 'const a = 1;' },
		{ path: 'busy.ts', content: 'if (a) {}\nif (b) {}\nwhile (c) {}' }
	]);
	assert.deepStrictEqual(ranked.map((f) => f.path), ['busy.ts', 'simple.ts']);
});

test('取り込んでいるモジュール名を拾う', () => {
	const content = ["import * as vscode from 'vscode';", "import { a } from './a';"].join('\n');
	assert.deepStrictEqual(importedModules(content), ['vscode', './a']);
});

test('core/ が vscode を取り込んでいたら違反として挙げる', () => {
	const violations = findLayerViolations([
		{ path: 'src/core/a.ts', content: "import * as vscode from 'vscode';" },
		{ path: 'src/view.ts', content: "import * as vscode from 'vscode';" }
	]);
	assert.deepStrictEqual(violations.map((v) => v.path), ['src/core/a.ts']);
});

test('違反には理由が付く（読んだ人が直せるように）', () => {
	const [violation] = findLayerViolations([{ path: 'src/core/a.ts', content: "import 'vscode';\nimport x from 'vscode';" }]);
	assert.ok(violation.reason.includes('拡張ホストなしで検証できなくなる'));
});

test('違反が無ければ、その節は出さない', () => {
	assert.ok(!renderStructure([], []).includes('層の約束'));
});

test('数字は判定ではないと明記する', () => {
	const text = renderStructure(rankComplexity([{ path: 'a.ts', content: 'if (x) {}' }]), []);
	assert.ok(text.includes('良し悪しの判定ではありません'));
});
