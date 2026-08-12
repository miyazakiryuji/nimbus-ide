/**
 * Flutter の確認（T-194 / T-195）の単体テスト。
 *
 * 誤検知が続くとこの手の指摘は読まれなくなるので、**拾わない条件**を重点的に押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { lintFlutterSource, renderFlutterLint, suggestArbEntries } from '../core/flutterLint';

test('日本語の直書きを拾う', () => {
	const findings = lintFlutterSource('a.dart', "Text('こんにちは')");
	assert.deepStrictEqual(findings.map((f) => `${f.kind}:${f.text}`), ['hardcoded-text:こんにちは']);
});

test('国際化されている行は拾わない', () => {
	const lines = ["Text(l10n.hello)", "Text(AppLocalizations.of(context)!.hello)", "Text(S.of(context).hello)"];
	assert.deepStrictEqual(lines.flatMap((l) => lintFlutterSource('a.dart', l)), []);
});

test('英語だけの文字列は拾わない（識別子と見分けがつかないため）', () => {
	assert.deepStrictEqual(lintFlutterSource('a.dart', "Text('OK')"), []);
});

test('コメント行は見ない', () => {
	assert.deepStrictEqual(lintFlutterSource('a.dart', "// Text('こんにちは')"), []);
});

test('semanticLabel の無い画像を拾う', () => {
	assert.deepStrictEqual(
		lintFlutterSource('a.dart', "Image.asset('a.png')").map((f) => f.kind),
		['missing-semantics']
	);
});

test('semanticLabel が次の行にあれば拾わない（引数は複数行に散る）', () => {
	const source = ['Image.asset(', "  'a.png',", "  semanticLabel: '写真',", ')'].join('\n');
	assert.deepStrictEqual(lintFlutterSource('a.dart', source), []);
});

test('tooltip の無い IconButton を拾う', () => {
	assert.deepStrictEqual(
		lintFlutterSource('a.dart', 'IconButton(onPressed: x, icon: Icon(Icons.add))').map((f) => f.kind),
		['missing-tooltip']
	);
});

test('.arb の候補は重複を畳んで出す', () => {
	const findings = lintFlutterSource('a.dart', ["Text('やあ')", "Text('やあ')", "Text('また')"].join('\n'));
	assert.deepStrictEqual(suggestArbEntries(findings).match(/"message\d+"/g), ['"message1"', '"message2"']);
});

test('何も無ければ、その旨だけを書く', () => {
	assert.ok(renderFlutterLint([]).includes('見つかりませんでした'));
});

test('出力には「直すかは人が決める」と書く', () => {
	assert.ok(renderFlutterLint(lintFlutterSource('a.dart', "Text('やあ')")).includes('人が決めてください'));
});
