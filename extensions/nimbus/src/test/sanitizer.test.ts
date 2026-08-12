/**
 * サニタイザ。
 * ここが漏れると、利用者がログを issue に貼った瞬間に資格情報が流出する。
 * 「取り漏らすより誤マスクする方がまし」という方向に倒っていることを固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { createSanitizer } from '../sanitizer';

const sanitizer = createSanitizer({}, '/Users/someone');

test('Anthropic の API キーを伏せる', () => {
	const out = sanitizer.sanitizeString('key=sk-ant-api03-ABCDEFGHIJKLMNOP');
	assert.ok(!out.includes('sk-ant-api03-ABCDEFGHIJKLMNOP'), out);
});

test('GitHub / Slack / Bearer / JWT も伏せる', () => {
	const samples = [
		'ghp_abcdefghijklmnopqrstuvwxyz0123',
		'xoxb-1234567890-abcdefghij',
		'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
		'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'
	];
	for (const sample of samples) {
		const out = sanitizer.sanitizeString(sample);
		assert.notStrictEqual(out, sample, `伏せられていない: ${sample}`);
	}
});

test('ホームディレクトリを ~ に置き換える（OS のユーザー名を残さない）', () => {
	const out = sanitizer.sanitizeString('cwd=/Users/someone/work/secret-project');
	assert.ok(!out.includes('/Users/someone'), out);
	assert.ok(out.includes('~/work/secret-project'), out);
});

test('機密らしい環境変数の値を、名前から推測して伏せる', () => {
	const withEnv = createSanitizer({ MY_API_TOKEN: 'super-secret-value-1234' }, '/tmp/home');
	const out = withEnv.sanitizeString('起動: MY_API_TOKEN=super-secret-value-1234');
	assert.ok(!out.includes('super-secret-value-1234'), out);
});

test('短い環境変数の値は伏せない（誤マスクで文章が壊れる）', () => {
	const withEnv = createSanitizer({ MY_KEY: 'true' }, '/tmp/home');
	assert.strictEqual(withEnv.sanitizeString('flag=true'), 'flag=true');
});

test('普通の文章はそのまま通す', () => {
	const text = 'セッションを開始しました（model=claude-opus-5）';
	assert.strictEqual(sanitizer.sanitizeString(text), text);
});

test('入れ子の値もまとめて伏せる（保存経路は必ずここを通る）', () => {
	const value = sanitizer.sanitizeValue({ nested: { token: 'ghp_abcdefghijklmnopqrstuvwxyz0123' }, ok: 1 });
	assert.ok(!JSON.stringify(value).includes('ghp_abcdefghijklmnopqrstuvwxyz0123'));
	assert.strictEqual(value.ok, 1);
});
