/**
 * LSP ツールの入力解決と結果整形。
 *
 * ここで固めたいのは 3 つ。
 *   - ワークスペースの外を参照させないこと
 *   - 行・桁の数え方（モデルは 1 起点、VS Code は 0 起点）を取り違えないこと
 *   - 名前だけ言われても目的のシンボルに辿り着けること
 */
import * as assert from 'assert';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { test } from 'node:test';
import {
	displayPath,
	findSymbol,
	formatLocation,
	positionInText,
	renderHover,
	renderLocations,
	renderOutline,
	resolveWorkspacePath,
	severityLabel,
	symbolKindLabel,
	symbolPosition,
	toPosition,
	type OutlineSymbol
} from '../core/lsp';

function range(startLine: number, startCharacter: number, endLine = startLine, endCharacter = startCharacter + 1) {
	return { start: { line: startLine, character: startCharacter }, end: { line: endLine, character: endCharacter } };
}

function workspace(): string {
	const root = mkdtempSync(join(tmpdir(), 'nimbus-lsp-'));
	mkdirSync(join(root, 'src'), { recursive: true });
	writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1;\n');
	return root;
}

test('相対パスはワークスペースを起点に解決する', () => {
	const root = workspace();
	assert.deepStrictEqual(resolveWorkspacePath([root], 'src/a.ts'), { path: join(root, 'src', 'a.ts') });
	assert.deepStrictEqual(resolveWorkspacePath([root], join(root, 'src', 'a.ts')), { path: join(root, 'src', 'a.ts') });
});

test('ワークスペースの外と、存在しないファイルは断る', () => {
	const root = workspace();
	assert.deepStrictEqual(resolveWorkspacePath([root], '../secrets.txt'), {
		error: 'ワークスペースの外は参照できません: ../secrets.txt'
	});
	assert.deepStrictEqual(resolveWorkspacePath([root], '/etc/passwd'), {
		error: 'ワークスペースの外は参照できません: /etc/passwd'
	});
	assert.deepStrictEqual(resolveWorkspacePath([root], 'src/none.ts'), {
		error: 'ファイルが見つかりません: src/none.ts'
	});
	assert.deepStrictEqual(resolveWorkspacePath([], 'src/a.ts'), { error: 'フォルダが開かれていません。' });
	assert.deepStrictEqual(resolveWorkspacePath([root], '  '), { error: 'file を指定してください。' });
});

test('複数フォルダのうち、実在する側を選ぶ', () => {
	const first = mkdtempSync(join(tmpdir(), 'nimbus-lsp-'));
	const second = workspace();
	assert.deepStrictEqual(resolveWorkspacePath([first, second], 'src/a.ts'), { path: join(second, 'src', 'a.ts') });
});

test('表示はワークスペースからの相対パスにする', () => {
	assert.strictEqual(displayPath(['/repo'], '/repo/src/a.ts'), join('src', 'a.ts'));
	assert.strictEqual(displayPath(['/repo'], '/other/b.ts'), '/other/b.ts');
});

test('行・桁は 1 起点で受け取り 0 起点に落とす', () => {
	assert.deepStrictEqual(toPosition(1, 1), { position: { line: 0, character: 0 } });
	assert.deepStrictEqual(toPosition(12), { position: { line: 11, character: 0 } });
	assert.deepStrictEqual(toPosition(0), { error: 'line は 1 以上の整数で指定してください（1 行目が 1）。' });
	assert.deepStrictEqual(toPosition(3, 0), { error: 'column は 1 以上の整数で指定してください（行頭が 1）。' });
});

const outline: OutlineSymbol[] = [
	{
		name: 'SessionManager',
		kind: 4,
		range: range(10, 0, 90, 1),
		selection: range(10, 13),
		children: [
			{ name: 'close', kind: 5, range: range(30, 1, 34, 2), selection: range(30, 8) },
			{ name: 'list', kind: 5, range: range(40, 1, 44, 2), selection: range(40, 8) }
		]
	},
	{ name: 'close', kind: 11, range: range(95, 0, 99, 1), selection: range(95, 9) }
];

test('名前・入れ子の経路・大文字小文字ゆれのどれでもシンボルに辿り着く', () => {
	assert.strictEqual(findSymbol(outline, 'SessionManager.list')?.range.start.line, 40);
	assert.strictEqual(findSymbol(outline, 'sessionmanager')?.range.start.line, 10);
	assert.strictEqual(findSymbol(outline, 'list')?.range.start.line, 40);
	assert.strictEqual(findSymbol(outline, 'まだ無い名前'), undefined);
});

test('同名は浅い方（外側の宣言）を先に返す', () => {
	assert.strictEqual(findSymbol(outline, 'close')?.range.start.line, 95);
});

test('ジャンプ位置は名前の範囲を使う', () => {
	assert.deepStrictEqual(symbolPosition(outline[0]), { line: 10, character: 13 });
	assert.deepStrictEqual(symbolPosition({ name: 'x', kind: 12, range: range(5, 2) }), { line: 5, character: 2 });
});

test('アウトラインが無い言語では、宣言らしい行を優先して位置を割り出す', () => {
	const source = ['run(1)', 'const other = run', 'function run(n) {', '  return n', '}'].join('\n');
	assert.deepStrictEqual(positionInText(source, 'run'), { line: 2, character: 9 });
});

test('宣言が見つからなければ最初の出現に落とす。部分一致では拾わない', () => {
	assert.deepStrictEqual(positionInText('a = run(1)\nrun(2)', 'run'), { line: 0, character: 4 });
	assert.strictEqual(positionInText('rerun()', 'run'), undefined);
	// 参照でしかない `= run` を宣言と取り違えない
	assert.deepStrictEqual(positionInText('const other = run\nrun()', 'run'), { line: 0, character: 14 });
});

test('入れ子の指定は末尾の名前で探す（本文には入れ子が現れないため）', () => {
	assert.deepStrictEqual(positionInText('class A {\n  b() {}\n}', 'A.b'), { line: 1, character: 2 });
});

test('場所は 1 起点に戻して出し、多すぎるときは切る', () => {
	const entries = [
		{ file: '/repo/src/a.ts', range: range(0, 0), preview: 'const a = 1' },
		{ file: '/repo/src/b.ts', range: range(11, 4) },
		{ file: '/repo/src/c.ts', range: range(2, 0) }
	];
	assert.strictEqual(formatLocation(['/repo'], entries[0]), `${join('src', 'a.ts')}:1:1  const a = 1`);
	assert.strictEqual(
		renderLocations(['/repo'], entries, 2),
		[`${join('src', 'a.ts')}:1:1  const a = 1`, `${join('src', 'b.ts')}:12:5`, '…他 1 件'].join('\n')
	);
	assert.strictEqual(renderLocations(['/repo'], [], 5), '（見つかりませんでした）');
});

test('アウトラインは入れ子のまま字下げして渡す', () => {
	assert.strictEqual(
		renderOutline(outline),
		[
			'- Class SessionManager  (11–91)',
			'  - Method close  (31–35)',
			'  - Method list  (41–45)',
			'- Function close  (96–100)'
		].join('\n')
	);
});

test('hover は重複を落とし、長すぎるものは切る', () => {
	assert.strictEqual(renderHover(['const a: number', ' const a: number ', '']), 'const a: number');
	assert.strictEqual(renderHover([]), '（型情報は取得できませんでした）');
	assert.strictEqual(renderHover(['x'.repeat(20)], 10), `${'x'.repeat(10)}\n…（省略）`);
});

test('種類と深刻度は読める言葉にする', () => {
	assert.deepStrictEqual([symbolKindLabel(4), symbolKindLabel(11), symbolKindLabel(99)], ['Class', 'Function', 'Symbol']);
	assert.deepStrictEqual([severityLabel(0), severityLabel(1), severityLabel(9)], ['error', 'warning', 'info']);
});
