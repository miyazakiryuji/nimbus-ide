/**
 * ターミナル出力の自動キャプチャ。
 *
 * ここで固めたいのは 3 つ。
 *   - 声をかける相手を間違えないこと（成功・自分で止めたもの・雑多なコマンドでは黙る）
 *   - 端末の見た目（色・進捗バーの書き戻し）を落として、読める形にすること
 *   - 長い出力を末尾から切ること。失敗の理由は終わりにある
 *
 * 守っている修正（T-274）: T-169
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildFailurePrompt,
	collapseCarriageReturns,
	failureHeadline,
	isRetriableBuild,
	normalizeOutput,
	shouldOfferCapture,
	stripAnsi,
	tailLines
} from '../core/terminalCapture';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

test('色・カーソル移動・シェル統合の制御列を落とす', () => {
	const colored = `${ESC}[31mFAIL${ESC}[0m src/a.test.ts`;
	const withOsc = `${ESC}]633;C${BEL}npm test`;
	assert.deepStrictEqual([stripAnsi(colored), stripAnsi(withOsc)], ['FAIL src/a.test.ts', 'npm test']);
});

test('進捗バーの書き戻しは、最後に書かれたものだけを残す', () => {
	assert.strictEqual(collapseCarriageReturns('20%\r60%\r100%\ndone'), '100%\ndone');
});

test('均した出力は行末の空白を持たない', () => {
	assert.strictEqual(normalizeOutput(`ok  \t\n${ESC}[2mnote${ESC}[0m  `), 'ok\nnote');
});

test('末尾から切り、落とした行数を数える', () => {
	const source = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
	assert.deepStrictEqual(tailLines(source, 3), { text: 'line 7\nline 8\nline 9', omittedLines: 7 });
	assert.deepStrictEqual(tailLines('a\nb\n\n\n', 10), { text: 'a\nb', omittedLines: 0 });
});

test('行数に収まっていても、文字数が多すぎれば古い行から落とす', () => {
	const source = ['x'.repeat(80), 'y'.repeat(80), 'z'.repeat(80)].join('\n');
	assert.deepStrictEqual(tailLines(source, 10, 100), { text: 'z'.repeat(80), omittedLines: 2 });
});

test('成功・中断・雑多なコマンドには声をかけない', () => {
	assert.deepStrictEqual(
		[
			shouldOfferCapture('npm test', 1),
			shouldOfferCapture('npm test', 0),
			shouldOfferCapture('npm test', undefined),
			shouldOfferCapture('npm test', 130),
			shouldOfferCapture('cd /tmp', 1),
			shouldOfferCapture('/usr/bin/ls -la', 2),
			shouldOfferCapture('   ', 1)
		],
		[true, false, false, false, false, false, false]
	);
});

test('自動リトライの対象は、直して打ち直す意味があるものだけ（T-106）', () => {
	assert.deepStrictEqual(
		[
			'npm run build',
			'npm run typecheck',
			'tsc -p .',
			'./gradlew assembleDebug',
			'flutter build ios',
			'make',
			'cargo check'
		].map(isRetriableBuild),
		[true, true, true, true, true, true, true]
	);
	assert.deepStrictEqual(
		['npm install', 'rm -rf build', 'git push', 'npm run deploy', ''].map(isRetriableBuild),
		[false, false, false, false, false]
	);
});

test('通知の見出しは、長いコマンドを切って終了コードを添える', () => {
	assert.strictEqual(failureHeadline('  npm   test  ', 1), 'npm test が失敗しました（終了コード 1）');
	assert.strictEqual(
		failureHeadline('a'.repeat(80), 2),
		`${'a'.repeat(60)}… が失敗しました（終了コード 2）`
	);
});

test('投入する文はコマンド・作業ディレクトリ・出力の末尾を含む', () => {
	const prompt = buildFailurePrompt({
		commandLine: 'npm test',
		cwd: '/repo',
		exitCode: 1,
		output: `line 0\nline 1\n${ESC}[31mFAIL${ESC}[0m`,
		maxLines: 2
	});
	assert.strictEqual(
		prompt,
		[
			'ターミナルで実行した次のコマンドが失敗しました（終了コード 1）。',
			'',
			'    npm test',
			'',
			'作業ディレクトリ: /repo',
			'',
			'出力の末尾（先頭 1 行は省略）:',
			'````',
			'line 1',
			'FAIL',
			'````',
			'',
			'原因を調べて直してください。まず何が起きているかを説明してから、修正に入ってください。'
		].join('\n')
	);
});

test('出力が空でも投入できる（コマンドと終了コードだけで足りることがある）', () => {
	const prompt = buildFailurePrompt({ commandLine: 'make', exitCode: 2, output: '' });
	assert.ok(prompt.includes('（出力はありません）'), prompt);
	assert.ok(!prompt.includes('作業ディレクトリ'), prompt);
});
