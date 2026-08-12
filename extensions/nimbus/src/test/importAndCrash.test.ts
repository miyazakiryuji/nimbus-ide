/**
 * ワンクリック導入・実機ログ（T-071 / T-074）の単体テスト。
 *
 * URL は **https だけ**通すこと、クラッシュログは
 * **自分のコードが無いときに無いと言う**ことが要。
 *
 * T-068（他ツールの取り込み）は `core/importRules.ts` 側のテストが持つ。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { checkBundleUrl } from '../core/importSettings';
import { buildCrashPrompt, parseCrashLog } from '../core/crashLog';

test('ワンクリック導入は https だけ通す', () => {
	assert.deepStrictEqual(checkBundleUrl('https://example.com/b.json'), { ok: true, url: 'https://example.com/b.json' });
	// リンクを押しただけで意図しないものが入る経路を作らない
	assert.strictEqual(checkBundleUrl('http://example.com/b.json').ok, false);
	assert.strictEqual(checkBundleUrl('file:///etc/passwd').ok, false);
	assert.strictEqual(checkBundleUrl('こわれた').ok, false);
});

const FLUTTER_LOG = [
	'E/flutter: Unhandled Exception: type Null is not a subtype of type String',
	'#0      LoginPage.build (package:app/ui/login_page.dart:42:15)',
	'#1      StatefulElement.build (package:flutter/src/widgets/framework.dart:5080:27)',
	'#2      ComponentElement.performRebuild (package:flutter/src/widgets/framework.dart:4966:15)'
].join('\n');

test('自分のコードのフレームと、ライブラリのフレームを分ける', () => {
	const report = parseCrashLog(FLUTTER_LOG);
	assert.strictEqual(report.frames.length, 3);
	assert.deepStrictEqual(report.ownFrames.map((f) => f.file), ['package:app/ui/login_page.dart']);
	assert.strictEqual(report.ownFrames[0].line, 42);
	assert.ok(report.headline.includes('Null is not a subtype'));
});

test('渡す文は全文を貼らず、自分のコードを先に置く', () => {
	const prompt = buildCrashPrompt(parseCrashLog(FLUTTER_LOG));
	assert.ok(prompt.includes('login_page.dart:42'));
	// ライブラリのフレームは畳む
	assert.ok(!prompt.includes('framework.dart'));
	assert.ok(prompt.includes('2 件は畳みました'));
	assert.ok(prompt.includes('直すのはその後です'));
});

test('自分のコードが 1 つも無ければ、無いと言う', () => {
	const report = parseCrashLog('at Object.<anonymous> (/w/node_modules/lib/index.js:10:3)');
	assert.deepStrictEqual(report.ownFrames, []);
	const prompt = buildCrashPrompt(report);
	assert.ok(prompt.includes('見つかりませんでした'));
	assert.ok(prompt.includes('呼び出し元から辿って'));
});

test('JS のスタックトレースも読む', () => {
	const report = parseCrashLog('TypeError: x is not a function\n    at run (/w/src/app.ts:12:5)');
	assert.deepStrictEqual(report.ownFrames.map((f) => [f.file, f.line]), [['/w/src/app.ts', 12]]);
});
