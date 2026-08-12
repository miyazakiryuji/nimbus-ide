/**
 * Claude Code の更新に気づく。
 *
 * バージョン番号だけでは「何が増えたか」は分からない。
 * **init が渡す一覧の差分**なら、推測せずに言える。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildUpgradePrompt,
	describeUpgrade,
	diffCapabilities,
	isWorthTelling,
	type Capabilities
} from '../core/versionWatch';

const BEFORE: Capabilities = {
	version: '2.1.0',
	tools: ['Read', 'Write'],
	slashCommands: ['/help'],
	skills: ['pptx'],
	agents: []
};
const AFTER: Capabilities = {
	version: '2.2.0',
	tools: ['Read', 'Write', 'Skill'],
	slashCommands: ['/help', '/loop'],
	skills: ['pptx'],
	agents: ['reviewer']
};

test('増えたものだけを拾う（消えたものは見ない）', () => {
	const diff = diffCapabilities(AFTER, BEFORE);
	assert.deepStrictEqual([diff.addedTools, diff.addedCommands, diff.addedAgents], [[], [], []]);
	const forward = diffCapabilities(BEFORE, AFTER);
	assert.deepStrictEqual(
		[forward.addedTools, forward.addedCommands, forward.addedSkills, forward.addedAgents],
		[['Skill'], ['/loop'], [], ['reviewer']]
	);
});

test('バージョンも中身も変わっていなければ黙る', () => {
	assert.strictEqual(isWorthTelling(diffCapabilities(BEFORE, BEFORE)), false);
	assert.strictEqual(isWorthTelling(diffCapabilities(BEFORE, AFTER)), true);
});

test('通知は増えたものを名指しする', () => {
	assert.strictEqual(
		describeUpgrade(diffCapabilities(BEFORE, AFTER)),
		[
			'Claude Code が 2.1.0 → 2.2.0 に上がりました',
			'  ツール: Skill',
			'  スラッシュコマンド: /loop',
			'  サブエージェント: reviewer'
		].join('\n')
	);
});

test('投入する文は「知らないものは知らないと言って」を含む', () => {
	const prompt = buildUpgradePrompt(diffCapabilities(BEFORE, AFTER));
	assert.ok(prompt.includes('**知らないものは「知らない」と言ってください。**'), prompt);
	assert.ok(prompt.includes('- ツール: Skill'), prompt);
	assert.strictEqual(buildUpgradePrompt(diffCapabilities(BEFORE, BEFORE)), '');
});
