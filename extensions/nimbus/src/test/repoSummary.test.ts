/**
 * リポジトリの構造要約カード。
 *
 * 数えた事実しか書かない、が要件。推測を混ぜると、それを前提に読まれてしまう。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildRepoSummaryPrompt,
	projectKinds,
	rankDirectories,
	renderRepoSummary,
	type RepoFacts
} from '../core/repoSummary';

const FACTS: RepoFacts = {
	name: 'nimbus',
	description: 'a cockpit for piloting Claude Code agents',
	manifests: ['package.json'],
	directories: [
		{ name: 'src', files: 120 },
		{ name: 'extensions', files: 40 }
	],
	languages: [
		{ extension: '.ts', files: 150 },
		{ extension: '.md', files: 20 }
	],
	branch: 'nimbus',
	lastCommit: 'テストを足す（3 分前）',
	claudeMd: 2
};

test('manifest から種類を当てる（重複はまとめる）', () => {
	assert.deepStrictEqual(projectKinds(['package.json', 'pubspec.yaml']), ['Flutter / Dart', 'Node.js / TypeScript']);
	assert.deepStrictEqual(projectKinds(['pyproject.toml', 'requirements.txt']), ['Python']);
	assert.deepStrictEqual(projectKinds(['unknown.txt']), []);
});

test('ディレクトリはファイル数の多い順、空は出さない', () => {
	assert.deepStrictEqual(
		rankDirectories([
			{ name: 'b', files: 3 },
			{ name: 'a', files: 3 },
			{ name: 'empty', files: 0 },
			{ name: 'big', files: 10 }
		]),
		[
			{ name: 'big', files: 10 },
			{ name: 'a', files: 3 },
			{ name: 'b', files: 3 }
		]
	);
});

test('カードは事実だけを並べる', () => {
	const card = renderRepoSummary(FACTS);
	assert.ok(card.startsWith('# nimbus\n'), card);
	assert.ok(card.includes('| 種類 | Node.js / TypeScript |'), card);
	assert.ok(card.includes('| ブランチ | nimbus |'), card);
	assert.ok(card.includes('| CLAUDE.md | 2 個 |'), card);
	assert.ok(card.includes('- `src/` — 120 ファイル'), card);
	assert.ok(card.includes('.ts 150 · .md 20'), card);
	assert.ok(card.includes('設計の推測は含みません'), card);
});

test('無い情報は行ごと出さない', () => {
	const card = renderRepoSummary({
		name: 'bare',
		manifests: [],
		directories: [],
		languages: [],
		claudeMd: 0
	});
	assert.ok(!card.includes('種類'), card);
	assert.ok(!card.includes('ブランチ'), card);
	assert.ok(card.includes('| CLAUDE.md | なし |'), card);
});

test('セッションへ渡す文は、探索を省く目的を先に言う', () => {
	const prompt = buildRepoSummaryPrompt(FACTS);
	assert.ok(prompt.startsWith('このリポジトリの構造です。**まず構造を調べる往復を省くために渡します。**'), prompt);
	assert.ok(prompt.includes('# nimbus'), prompt);
});
