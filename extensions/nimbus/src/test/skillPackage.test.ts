/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { test } from 'node:test';
import { describePlan, isOwnSkill, planPackage, renderMarketplaceJson, renderReadme } from '../core/skillPackage';
import type { Skill } from '../core/skills';

const SKILLS: Skill[] = [
	{ name: 'slides', description: '資料を作る', path: '/w/.claude/skills/slides/SKILL.md', origin: 'プロジェクト' },
	{ name: 'notes', description: 'メモを整える', path: '/home/.claude/skills/notes/SKILL.md', origin: 'ユーザー' },
	{ name: 'borrowed', description: '他人のもの', path: '/p/skills/borrowed/SKILL.md', origin: 'プラグイン: shop' },
	{ name: 'nameless', description: '   ', path: '/w/.claude/skills/nameless/SKILL.md', origin: 'プロジェクト' }
];

const OPTIONS = { name: 'my-skills', owner: 'someone' };

test('配るのは自分で書いたものだけ（プラグイン由来は入れない）', () => {
	assert.deepStrictEqual(SKILLS.map(isOwnSkill), [true, true, false, true]);
});

test('入れないものは、理由つきで返す（黙って減らさない）', () => {
	const plan = planPackage(SKILLS, OPTIONS);
	assert.deepStrictEqual(plan.skipped, [
		{ name: 'borrowed', reason: 'プラグイン: shop から来たものなので、自分では配りません' },
		{ name: 'nameless', reason: '説明がありません（入れる側が選べません）' }
	]);
});

test('マーケットプレイスの形になる', () => {
	assert.deepStrictEqual(planPackage(SKILLS, OPTIONS).marketplace, {
		name: 'my-skills',
		owner: { name: 'someone' },
		plugins: [
			{ name: 'slides', source: './slides', description: '資料を作る' },
			{ name: 'notes', source: './notes', description: 'メモを整える' }
		]
	});
});

test('写す元は SKILL.md ではなくフォルダ', () => {
	assert.deepStrictEqual(planPackage(SKILLS, OPTIONS).files, [
		{ from: '/w/.claude/skills/slides', to: 'slides/skills/slides' },
		{ from: '/home/.claude/skills/notes', to: 'notes/skills/notes' }
	]);
});

test('秘密らしきものが入っていたら、入れたうえで知らせる', () => {
	const plan = planPackage([SKILLS[0]], {
		...OPTIONS,
		readSkill: () => 'API_KEY=...',
		inspect: () => ({ count: 2, kinds: ['鍵らしき文字列'] })
	});
	assert.deepStrictEqual(plan.warnings, [
		{ name: 'slides', reason: '鍵らしき文字列 が入っています（2 箇所）。出す前に見てください' }
	]);
	// 止めはしない。見るかどうかは人が決める
	assert.strictEqual(plan.marketplace.plugins.length, 1);
});

test('秘密が無ければ、何も言わない', () => {
	const plan = planPackage([SKILLS[0]], { ...OPTIONS, readSkill: () => 'ふつうの文', inspect: () => ({ count: 0, kinds: [] }) });
	assert.deepStrictEqual(plan.warnings, []);
});

test('owner を書かなければ、その欄は作らない', () => {
	assert.strictEqual(planPackage([SKILLS[0]], { name: 'my-skills' }).marketplace.owner, undefined);
	assert.ok(!renderMarketplaceJson(planPackage([SKILLS[0]], { name: 'my-skills' })).includes('owner'));
});

test('README には、そのまま打てる入れかたが載る', () => {
	const readme = renderReadme(planPackage(SKILLS, OPTIONS), 'someone/my-skills');
	assert.ok(readme.includes('/plugin marketplace add someone/my-skills'));
	assert.ok(readme.includes('/plugin install <名前>@my-skills'));
	assert.ok(readme.includes('- **slides** — 資料を作る'));
	assert.ok(readme.includes('次に始めるセッションから'));
});

test('リポジトリが決まっていなければ、埋める場所を残す', () => {
	assert.ok(renderReadme(planPackage(SKILLS, OPTIONS)).includes('<owner>/<repo>'));
});

test('作る前に、入るもの・入らないものを見せる', () => {
	const text = describePlan(planPackage(SKILLS, OPTIONS));
	assert.ok(text.startsWith('2 個を入れます。'));
	assert.ok(text.includes('入れないもの'));
	assert.ok(text.includes('borrowed'));
});
