/**
 * 指示の中で名指しされたシンボルの拾い方。
 *
 * ここで固めたいのは「拾いすぎないこと」。関係ない語まで引くと、
 * 指示より添付の方が長くなり、かえって精度が落ちる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { extractSymbolMentions, renderSignatureNote, signatureFromHover } from '../core/mentions';

test('バッククォート・入れ子の指定・呼び出しの形・PascalCase を拾う', () => {
	assert.deepStrictEqual(
		extractSymbolMentions('`createSession()` を直して。SessionManager.close も見て、buildOptions() の戻り値と TaskService を確認'),
		['createSession', 'SessionManager.close', 'buildOptions', 'TaskService']
	);
});

test('普通の文からは拾わない（短い語・よくある大文字語を落とす）', () => {
	assert.deepStrictEqual(extractSymbolMentions('The tests are failing. This is Nimbus の話です。'), []);
});

test('同じ名前は 1 回だけ、上限で打ち切る', () => {
	assert.deepStrictEqual(extractSymbolMentions('`foo` foo() Foo.bar `foo`', 2), ['foo', 'Foo.bar']);
});

test('hover からシグネチャらしい 1 行を取り出す', () => {
	assert.strictEqual(
		signatureFromHover('```typescript\nasync createSession(input: CreateSessionInput): Promise<string>\n```\n\n説明文'),
		'async createSession(input: CreateSessionInput): Promise<string>'
	);
	assert.strictEqual(signatureFromHover('x'.repeat(20), 5), 'xxxxx…');
});

test('添付は Nimbus が足したものだと分かる形にする', () => {
	assert.strictEqual(
		renderSignatureNote([{ mention: 'createSession', where: 'src/a.ts:90', signature: 'createSession(): void' }]),
		[
			'（Nimbus が添付した実際のシグネチャ。推測せずこちらを使ってください）',
			'- createSession — src/a.ts:90',
			'  createSession(): void'
		].join('\n')
	);
	assert.strictEqual(renderSignatureNote([]), '');
});
