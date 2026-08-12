/**
 * 使い始めの設定（T-203 / T-204）の単体テスト。
 *
 * **決めなくても始められる**（揃っていなくても止めない）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { guessPreset, PRESETS, renderSetup, setupSteps } from '../core/presets';

test('リポジトリの中身から言語を当てる', () => {
	assert.deepStrictEqual(
		[
			guessPreset(['pubspec.yaml', 'lib/main.dart']),
			guessPreset(['go.mod']),
			guessPreset(['Package.swift']),
			guessPreset(['package.json']),
			guessPreset(['README.md'])
		],
		['flutter', 'go', 'swift', 'node', 'general']
	);
});

test('Flutter と Node が同居していたら Flutter を選ぶ（重いほうに合わせる）', () => {
	assert.strictEqual(guessPreset(['package.json', 'pubspec.yaml']), 'flutter');
});

test('どのプリセットにも安全の設定が入っている', () => {
	assert.ok(
		PRESETS.every(
			(preset) =>
				preset.settings['nimbus.permissions.showDiffBeforeApproval'] === true &&
				preset.settings['nimbus.safety.blockProtectedReads'] === true
		)
	);
});

test('プリセットには CLAUDE.md の節が付いている', () => {
	assert.ok(PRESETS.every((preset) => preset.claudeMdSections.length > 0));
});

test('できていない項目には、必ずやることが付く', () => {
	const steps = setupSteps({ hasClaudeCode: false, hasClaudeMd: false, isTrusted: false, hasPreset: false });
	assert.ok(steps.every((step) => step.done || Boolean(step.todo)));
});

test('できている項目には、やることを付けない', () => {
	const steps = setupSteps({ hasClaudeCode: true, hasClaudeMd: true, isTrusted: true, hasPreset: true });
	assert.ok(steps.every((step) => step.todo === undefined));
});

test('揃っていなくても始められると書く', () => {
	const text = renderSetup(setupSteps({ hasClaudeCode: true, hasClaudeMd: false, isTrusted: true, hasPreset: false }));
	assert.ok(text.includes('全部そろっていなくても始められます'));
});

test('揃っていれば、次にやることを書く', () => {
	const text = renderSetup(setupSteps({ hasClaudeCode: true, hasClaudeMd: true, isTrusted: true, hasPreset: true }));
	assert.ok(text.includes('コックピットに指示を書いて始められます'));
});
