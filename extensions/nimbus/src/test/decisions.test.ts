/**
 * 会話から「決めたこと」を拾う。
 *
 * **取りこぼしより誤検出の方が悪い。** 関係ない文が記録に混ざると、
 * 次に読む人がその記録全体を信用しなくなる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	adrFileName,
	buildAdrPrompt,
	extractDecisions,
	nextAdrNumber,
	renderAdr,
	specTemplate
} from '../core/decisions';

const CONVERSATION = [
	'まず現状を確認します。',
	'認証は Cookie ではなく Bearer トークンにします。理由は SSR で扱いやすいからです。',
	'キャッシュの多段構成は見送ります。',
	'この関数は 3 箇所から呼ばれています。',
	'ライブラリは Riverpod を採用します。'
];

test('判断らしい文だけを拾う（説明や状況は拾わない）', () => {
	assert.deepStrictEqual(extractDecisions(CONVERSATION), [
		'認証は Cookie ではなく Bearer トークンにします。',
		'キャッシュの多段構成は見送ります。',
		'ライブラリは Riverpod を採用します。'
	]);
});

test('前置きから始まる文と、短すぎる文は拾わない', () => {
	assert.deepStrictEqual(extractDecisions(['まず A にします。', 'B にする。']), []);
});

test('同じ内容は 1 回だけ、上限で打ち切る', () => {
	const repeated = ['ライブラリは Riverpod を採用します。', 'ライブラリは Riverpod を採用します。'];
	assert.strictEqual(extractDecisions(repeated).length, 1);
	assert.strictEqual(extractDecisions(CONVERSATION, 1).length, 1);
});

test('投入する文は「なぜ」を必ず求め、誤検出があることも伝える', () => {
	const prompt = buildAdrPrompt(extractDecisions(CONVERSATION), 'nimbus/docs/specs/auth.md', '認証');
	assert.ok(prompt.includes('**取りこぼしと誤検出があります**'), prompt);
	assert.ok(prompt.includes('**決めたことには必ず「なぜそう決めたか」を添えてください。**'), prompt);
	assert.ok(prompt.includes('- キャッシュの多段構成は見送ります。'), prompt);
	assert.ok(prompt.includes('# 認証'), prompt);
});

test('拾えなかったときは、そう伝えて書き起こさせる', () => {
	const prompt = buildAdrPrompt([], 'nimbus/docs/specs/x.md', 'x');
	assert.ok(prompt.includes('機械では判断らしい発言を拾えませんでした。'), prompt);
});

test('型は既存の仕様書の見出しに合わせる', () => {
	assert.ok(specTemplate('題').includes('## 決めたこと'));
	assert.ok(specTemplate('題').includes('## 残っていること'));
});

test('ADR の番号は既存の最大 + 1、ファイル名は 4 桁で並ぶ', () => {
	assert.strictEqual(nextAdrNumber(['0001-a.md', '0003-b.md', 'README.md']), 4);
	assert.strictEqual(nextAdrNumber([]), 1);
	assert.strictEqual(adrFileName(4, '認証は Bearer トークン'), '0004-認証は-bearer-トークン.md');
	assert.strictEqual(adrFileName(12, '   '), '0012-decision.md');
});

test('ADR の下書きは「なぜ」と「選ばなかった案」を空欄で必ず置く', () => {
	const adr = renderAdr({
		number: 4,
		title: '認証方式',
		date: '2026-08-13',
		decisions: ['Bearer トークンにします。'],
		instructions: ['認証を直して'],
		touchedFiles: ['src/auth.ts']
	});
	assert.ok(adr.startsWith('# 0004. 認証方式\n'), adr);
	assert.ok(adr.includes('- Bearer トークンにします。\n  - なぜ: （ここを埋める）'), adr);
	assert.ok(adr.includes('## 選ばなかった案'), adr);
	assert.ok(adr.includes('- `src/auth.ts`'), adr);
	assert.ok(adr.includes('- 認証を直して'), adr);
});

test('決めたことが拾えなくても、埋める場所は残す', () => {
	const adr = renderAdr({ number: 1, title: 'x', date: '2026-08-13', decisions: [] });
	assert.ok(adr.includes('- （ここを埋める）'), adr);
	assert.ok(!adr.includes('この判断で触ったファイル'), adr);
});
