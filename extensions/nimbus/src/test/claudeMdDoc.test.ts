/**
 * CLAUDE.md をセクションとして扱う部分の単体テスト（node --test）。
 *
 * ここで押さえたいのは 3 つ。見出しの取り違え（コードブロック内の `#` を拾わない）、
 * 階層の判定（どれを直せばいいかが変わる）、重複追加の防止（CLAUDE.md が太る原因）。
 */
import * as assert from 'assert';
import { join } from 'path';
import { test } from 'node:test';
import {
	appendBullet,
	appendSection,
	classifyOrigin,
	displayLabel,
	estimateTokens,
	lintClaudeMd,
	parseSections,
	SECTION_TEMPLATES
} from '../core/claudeMdDoc';

test('見出しでセクションに分かれ、行番号を保つ', () => {
	const content = ['# タイトル', '', '前書き', '', '## 規約', '', 'タブを使う', '', '## テスト', '', '必ず書く'].join(
		'\n'
	);
	assert.deepStrictEqual(
		parseSections(content).map((s) => ({ title: s.title, level: s.level, line: s.line })),
		[
			{ title: 'タイトル', level: 1, line: 0 },
			{ title: '規約', level: 2, line: 4 },
			{ title: 'テスト', level: 2, line: 8 }
		]
	);
});

test('コードブロックの中の # は見出しにしない', () => {
	const content = ['# タイトル', '', '```bash', '# これはシェルのコメント', 'npm test', '```', '', '## 本物'].join('\n');
	assert.deepStrictEqual(
		parseSections(content).map((s) => s.title),
		['タイトル', '本物']
	);
});

test('見出しより前に書かれた本文も 1 つのセクションになる', () => {
	assert.deepStrictEqual(
		parseSections('前書きだけ\n\n## 節').map((s) => ({ title: s.title, level: s.level })),
		[
			{ title: '', level: 0 },
			{ title: '節', level: 2 }
		]
	);
});

test('空のファイルはセクションを持たない', () => {
	assert.deepStrictEqual(parseSections('\n\n'), []);
});

test('階層を判定する（プロジェクト / 継承 / ユーザー）', () => {
	const home = '/Users/x';
	const root = '/Users/x/work/app';
	assert.deepStrictEqual(
		[
			classifyOrigin(join(root, 'CLAUDE.md'), root, home),
			classifyOrigin('/Users/x/work/CLAUDE.md', root, home),
			classifyOrigin(join(home, '.claude', 'CLAUDE.md'), root, home)
		],
		['project', 'ancestor', 'user']
	);
});

test('表示名はプロジェクト相対・ホームは ~ に短縮する', () => {
	const home = '/Users/x';
	const root = '/Users/x/work/app';
	assert.deepStrictEqual(
		[
			displayLabel(join(root, 'CLAUDE.md'), root, home),
			displayLabel('/Users/x/work/CLAUDE.md', root, home),
			displayLabel(join(home, '.claude', 'CLAUDE.md'), root, home)
		],
		['CLAUDE.md', '~/work/CLAUDE.md', '~/.claude/CLAUDE.md']
	);
});

test('セクションを末尾に足す', () => {
	const { content, line } = appendSection('# タイトル\n\n本文\n', 'テストの方針', '必ず書く');
	assert.strictEqual(content, '# タイトル\n\n本文\n\n## テストの方針\n\n必ず書く\n');
	assert.strictEqual(line, 4);
});

test('同じ見出しがあるときは足さず、その行を返す（重複で太らせない）', () => {
	const original = '# タイトル\n\n## 規約\n\nタブを使う\n';
	const { content, line } = appendSection(original, '規約', '別の本文');
	assert.deepStrictEqual({ content, line }, { content: original, line: 2 });
});

test('空のファイルにも足せる', () => {
	assert.deepStrictEqual(appendSection('', '概要', '中身'), { content: '## 概要\n\n中身\n', line: 0 });
});

test('重複した見出しと、中身の無い節を指摘する', () => {
	const content = ['## 規約', '', 'タブを使う', '', '## メモ', '', '## 規約', '', '二重に書いた'].join('\n');
	assert.deepStrictEqual(
		lintClaudeMd(content).map((f) => ({ kind: f.kind, line: f.line })),
		[
			{ kind: 'empty-section', line: 4 },
			{ kind: 'duplicate-heading', line: 6 }
		]
	);
});

test('同じ行の重複を指摘する（短い行とコードブロックは見ない）', () => {
	const content = [
		'- テストは必ず書いてください',
		'- 短い行',
		'- 短い行',
		'```',
		'echo 同じ行のくり返しでも無視される',
		'echo 同じ行のくり返しでも無視される',
		'```',
		'- テストは必ず書いてください'
	].join('\n');
	assert.deepStrictEqual(
		lintClaudeMd(content).map((f) => ({ kind: f.kind, line: f.line })),
		[{ kind: 'duplicate-line', line: 7 }]
	);
});

test('短いファイルは長すぎるとは言わない / 長いファイルは指摘する', () => {
	assert.deepStrictEqual(
		[
			lintClaudeMd('## 節\n\n本文').some((f) => f.kind === 'too-long'),
			lintClaudeMd('## 節\n\n' + 'あ'.repeat(4000)).some((f) => f.kind === 'too-long')
		],
		[false, true]
	);
});

test('トークン数はおおよそ文字数の 2/3', () => {
	assert.strictEqual(estimateTokens('あ'.repeat(300)), 200);
});

test('ひな形は見出しと説明と本文を持つ', () => {
	assert.ok(SECTION_TEMPLATES.length > 0);
	assert.ok(SECTION_TEMPLATES.every((t) => t.heading.length > 0 && t.description.length > 0 && t.body.length > 0));
});

test('節の中に箇条書きを足す（末尾の空行より前に入る）', () => {
	const original = '# タイトル\n\n## 毎回の指示\n\n- テストも書く\n\n## 別の節\n\n本文\n';
	const { content, line } = appendBullet(original, '毎回の指示', 'コミットは細かく');
	assert.deepStrictEqual(
		{ line, body: content.split('\n').slice(2, 7) },
		{ line: 5, body: ['## 毎回の指示', '', '- テストも書く', '- コミットは細かく', ''] }
	);
});

test('節が無ければ作って足す', () => {
	const { content } = appendBullet('# タイトル\n', '毎回の指示', 'コミットは細かく');
	assert.strictEqual(content, '# タイトル\n\n## 毎回の指示\n\n- コミットは細かく\n');
});

test('同じ内容が既にあるときは足さず、その行を返す', () => {
	const original = '## 毎回の指示\n\n- テストも書く\n';
	assert.deepStrictEqual(appendBullet(original, '毎回の指示', 'テストも書く'), { content: original, line: 2 });
});
