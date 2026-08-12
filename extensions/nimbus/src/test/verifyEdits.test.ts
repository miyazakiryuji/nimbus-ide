/**
 * 生成直後の型検証。
 *
 * ここで固めたいのは 1 つに尽きる — **そのターンで増えたエラーだけ**を渡すこと。
 * 元から赤かった箇所まで突きつけると、頼んでいない修正が始まる。
 * 行番号は編集でずれるので、同じ指摘かどうかの判断に使ってはいけない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildVerifyPrompt,
	editedFilePath,
	newErrors,
	verifyHeadline,
	type DiagnosticLike
} from '../core/verifyEdits';

function diagnostic(partial: Partial<DiagnosticLike> & { message: string }): DiagnosticLike {
	return { file: '/repo/src/a.ts', line: 0, character: 0, severity: 0, ...partial };
}

test('書き換え系のツールからだけパスを取り出す', () => {
	assert.deepStrictEqual(
		[
			editedFilePath('Edit', { file_path: '/repo/a.ts' }),
			editedFilePath('Write', { file_path: '/repo/b.ts' }),
			editedFilePath('MultiEdit', { file_path: '/repo/c.ts' }),
			editedFilePath('NotebookEdit', { notebook_path: '/repo/d.ipynb' }),
			editedFilePath('Read', { file_path: '/repo/a.ts' }),
			editedFilePath('Edit', { file_path: '' }),
			editedFilePath('Edit', undefined)
		],
		['/repo/a.ts', '/repo/b.ts', '/repo/c.ts', '/repo/d.ipynb', undefined, undefined, undefined]
	);
});

test('元からあったエラーは増えたことにしない（行がずれても同じ指摘と見る）', () => {
	const before = [diagnostic({ message: '既にあった', line: 3 })];
	const after = [diagnostic({ message: '既にあった', line: 40 }), diagnostic({ message: '増えた', line: 41 })];
	assert.deepStrictEqual(newErrors(before, after).map((error) => error.message), ['増えた']);
});

test('同じ文言が複数あっても、増えた分だけを数える', () => {
	const before = [diagnostic({ message: '同じ' }), diagnostic({ message: '同じ' })];
	const after = [diagnostic({ message: '同じ' }), diagnostic({ message: '同じ' }), diagnostic({ message: '同じ' })];
	assert.strictEqual(newErrors(before, after).length, 1);
});

test('警告・情報は対象にしない（直す根拠が弱いものでループを回さない）', () => {
	const after = [diagnostic({ message: '警告', severity: 1 }), diagnostic({ message: '情報', severity: 2 })];
	assert.deepStrictEqual(newErrors([], after), []);
});

test('別ファイルの同じ文言は別物として扱う', () => {
	const before = [diagnostic({ message: '同じ', file: '/repo/src/a.ts' })];
	const after = [diagnostic({ message: '同じ', file: '/repo/src/b.ts' })];
	assert.deepStrictEqual(newErrors(before, after).map((error) => error.file), ['/repo/src/b.ts']);
});

test('差し戻す文は場所を 1 起点で出し、出どころを添える', () => {
	const prompt = buildVerifyPrompt(
		[diagnostic({ message: "Property 'foo' does not exist", line: 11, character: 4, source: 'ts' })],
		(file) => file.replace('/repo/', '')
	);
	assert.strictEqual(
		prompt,
		[
			'いまの編集で、次の型エラーが増えました（言語サーバーの診断です）。',
			'',
			"- src/a.ts:12:5 (ts) Property 'foo' does not exist",
			'',
			'存在しない API・引数の数の違い・import 漏れが無いか確かめて直してください。',
			'元から出ていたエラーは含めていません。'
		].join('\n')
	);
});

test('多すぎる指摘は切って「他 N 件」を添える。無ければ何も組み立てない', () => {
	const many = Array.from({ length: 25 }, (_, index) => diagnostic({ message: `エラー ${index}` }));
	const prompt = buildVerifyPrompt(many, (file) => file);
	assert.ok(prompt.includes('- …他 5 件'), prompt);
	assert.strictEqual(buildVerifyPrompt([], (file) => file), '');
});

test('見出しは件数とファイル数を言う', () => {
	assert.strictEqual(verifyHeadline(3, 2), 'いま書いたコードに型エラーが 3 件あります（2 ファイル）');
});
