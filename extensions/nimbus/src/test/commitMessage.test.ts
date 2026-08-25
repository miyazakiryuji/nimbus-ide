/**
 * コミットメッセージの型と生成の下ごしらえ（T-305 / T-309）。
 *
 * 生成そのもの（モデルの往復）はここでは扱えない。ここで固めるのは
 * **型の当てかた・巨大な diff の切り詰めかた・返ってきたものの整えかた** —
 * どれも間違えると「生成できたのに使えない」になる部分。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildCommitPrompt,
	checkMessageStyle,
	cleanGeneratedMessage,
	detectCommitStyle,
	detectLanguage,
	truncateDiff
} from '../core/commitMessage';

test('型は過去のコミットから数えて当てる（T-309）', () => {
	assert.deepStrictEqual(
		[
			// このリポジトリの形（Nimbus: 〜）は Conventional ではない → repo（まねる）
			detectCommitStyle(['Nimbus: 板を直す（T-283）', 'Nimbus: 表を描く（T-304）', 'feat: x']),
			// 過半数が Conventional なら conventional
			detectCommitStyle(['feat(ui): add tabs', 'fix: crash on save', 'docs: readme']),
			// 何も無ければ repo（まねるものが無くても、指示文が実例なしで成立する）
			detectCommitStyle([])
		],
		[
			{ style: 'repo', counts: { conventional: 1, other: 2, total: 3 } },
			{ style: 'conventional', counts: { conventional: 3, other: 0, total: 3 } },
			{ style: 'repo', counts: { conventional: 0, other: 0, total: 0 } }
		]
	);
});

test('言語も過去のコミットから当てる（T-309）', () => {
	assert.deepStrictEqual(
		[detectLanguage(['Nimbus: 板を直す']), detectLanguage(['feat: add tabs', 'fix: crash'])],
		['ja', 'en']
	);
});

test('巨大な diff はファイルの境界で切り、省いた名前を残す（T-305）', () => {
	const fileA = `diff --git a/a.ts b/a.ts\n+${'a'.repeat(100)}\n`;
	const fileB = `diff --git a/b.ts b/b.ts\n+${'b'.repeat(100)}\n`;
	const result = truncateDiff(fileA + fileB, 150);
	assert.deepStrictEqual(
		[result.truncated, result.text.includes('a.ts'), result.text.includes(`+${'b'.repeat(100)}`), result.text.includes('省略: b.ts')],
		[true, true, false, true]
	);
	// 収まっていれば手を付けない
	assert.deepStrictEqual(truncateDiff(fileA, 1000), { text: fileA, truncated: false });
});

test('指示文に、型の手本と全体像と diff が入る（T-305）', () => {
	const prompt = buildCommitPrompt({
		diff: '+ 変更',
		stat: ' a.ts | 2 +-',
		style: 'repo',
		recentSubjects: ['Nimbus: 板を直す（T-283）'],
		language: 'ja',
		subjectMax: 72,
		body: true,
		coAuthor: false
	});
	assert.deepStrictEqual(
		[
			prompt.includes('Nimbus: 板を直す（T-283）'),
			prompt.includes('a.ts | 2 +-'),
			prompt.includes('+ 変更'),
			prompt.includes('72 文字以内'),
			prompt.includes('コミットメッセージだけ')
		],
		[true, true, true, true, true]
	);
});

test('返ってきた前置きとコードフェンスを剥がす（T-305）', () => {
	assert.deepStrictEqual(
		[
			cleanGeneratedMessage('```\nNimbus: 表を描く（T-304）\n```'),
			cleanGeneratedMessage('コミットメッセージ:\nNimbus: 表を描く（T-304）'),
			cleanGeneratedMessage('  Nimbus: 表を描く（T-304）  ')
		],
		['Nimbus: 表を描く（T-304）', 'Nimbus: 表を描く（T-304）', 'Nimbus: 表を描く（T-304）']
	);
});

test('メッセージの検査は、直しかたが分かる言葉で返す（T-307 の git_commit が使う）', () => {
	assert.deepStrictEqual(
		[
			checkMessageStyle('feat: add tabs', 'conventional', 72),
			checkMessageStyle('タブを足す', 'conventional', 72),
			checkMessageStyle(`${'あ'.repeat(80)}`, 'repo', 72),
			checkMessageStyle('1 行目\n本文がすぐ続く', 'repo', 72),
			checkMessageStyle('1 行目\n\n本文', 'repo', 72),
			checkMessageStyle('', 'repo', 72)
		],
		[
			undefined,
			'1 行目が Conventional Commits（`type(scope): summary`）の形になっていません。',
			'1 行目が 80 文字あります（上限 72 文字）。',
			'1 行目と本文の間に空行がありません。',
			undefined,
			'1 行目が空です。'
		]
	);
});
