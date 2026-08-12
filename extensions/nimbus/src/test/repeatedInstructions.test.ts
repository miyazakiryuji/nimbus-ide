/**
 * 繰り返している指示の検出（T-041 の残り）の単体テスト。
 *
 * 提案は「毎回言っていること」だけを出さないと雑音になり、読まれなくなる。
 * ここでは**拾いすぎないこと**を重点的に押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	findRepeatedInstructions,
	normalizeInstruction,
	splitInstructions
} from '../core/repeatedInstructions';

test('言い回しのゆれを落として比べる（意味は変えない）', () => {
	assert.deepStrictEqual(
		[
			normalizeInstruction('テストも一緒に書いてください。'),
			normalizeInstruction('**テストも一緒に書いて**'),
			normalizeInstruction('テストも一緒に書いてほしい')
		],
		// 丁寧形と、そのあとに残る「て」まで落とすので 3 つとも同じ鍵になる
		['テストも一緒に書い', 'テストも一緒に書い', 'テストも一緒に書い']
	);
});

test('別の指示は同じにならない', () => {
	assert.notStrictEqual(normalizeInstruction('テストを書いて'), normalizeInstruction('ドキュメントを書いて'));
});

test('1 通の中の複数の指示を文単位で割る（箇条書きの記号は落とす）', () => {
	assert.deepStrictEqual(
		splitInstructions('- コミットは細かくしてください\n- テストも一緒に書いてください\nOK'),
		['コミットは細かくしてください', 'テストも一緒に書いてください']
	);
});

test('短い相槌は指示として数えない', () => {
	assert.deepStrictEqual(splitInstructions('OK\nお願い\nはい'), []);
});

test('3 回以上言っているものだけを、多い順に返す', () => {
	const messages = [
		'テストも一緒に書いてください。コミットは細かくしてください。',
		'テストも一緒に書いて',
		'**テストも一緒に書いてください**',
		'コミットは細かくしてください',
		'コミットは細かくしてください',
		'これは一度きりの指示です'
	];
	assert.deepStrictEqual(
		findRepeatedInstructions(messages).map((r) => ({ text: r.text, count: r.count })),
		// 回数が同じときは文字順（並びが実行ごとに変わらないようにするため）
		[
			{ text: 'コミットは細かくしてください。', count: 3 },
			{ text: 'テストも一緒に書いてください。', count: 3 }
		]
	);
});

test('同じメッセージの中で 2 回言っても 1 回と数える（コピペで跳ねさせない）', () => {
	const pasted = 'テストも一緒に書いてください\nテストも一緒に書いてください\nテストも一緒に書いてください';
	assert.deepStrictEqual(findRepeatedInstructions([pasted, pasted]), []);
});

test('しきい値は変えられる', () => {
	assert.strictEqual(findRepeatedInstructions(['テストも一緒に書いて', 'テストも一緒に書いて'], 2).length, 1);
});

test('スラッシュコマンドの展開や実行結果の差し込みは指示として数えない', () => {
	assert.deepStrictEqual(
		splitInstructions(
			[
				'<command-name>/effort</command-name>',
				'<local-command-stdout>Set effort level to max</local-command-stdout>',
				'[Request interrupted by user for tool use]',
				'テストも一緒に書いてください'
			].join('\n')
		),
		['テストも一緒に書いてください']
	);
});
