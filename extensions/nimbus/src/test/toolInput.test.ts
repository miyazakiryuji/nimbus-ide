/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * ツール入力の共通取り出しの守り。ツリービューの共通土台（T-236）のうち
 * 「ツール入力の取り出しも共通化」の側 — ここが崩れると 4 ビューが同時にズレる。
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { commandOf, filePathOf, READ_TOOLS, WRITE_TOOLS } from '../core/toolInput';

describe('toolInput', () => {
	test('ツールごとに違うキー名を吸収する', () => {
		assert.deepStrictEqual(
			[
				{ file_path: '/w/a.ts' },
				{ notebook_path: '/w/a.ipynb' },
				{ path: '/w/a.md' }
			].map(filePathOf),
			['/w/a.ts', '/w/a.ipynb', '/w/a.md']
		);
	});

	test('複数のキーがあるときは file_path を優先する', () => {
		assert.strictEqual(filePathOf({ path: '/w/b.md', file_path: '/w/a.ts' }), '/w/a.ts');
		assert.strictEqual(filePathOf({ path: '/w/b.md', notebook_path: '/w/a.ipynb' }), '/w/a.ipynb');
	});

	test('パスが取れないものは undefined（空文字も取れないものとして扱う）', () => {
		assert.deepStrictEqual(
			[undefined, null, 'text', 42, {}, { file_path: '' }, { file_path: 123 }].map(filePathOf),
			[undefined, undefined, undefined, undefined, undefined, undefined, undefined]
		);
	});

	test('コマンドは空白を畳んで前後を落とす（同じ実行を別物に見せないため）', () => {
		assert.deepStrictEqual(
			[{ command: '  npm   run\n  test  ' }, { command: 'ls' }].map(commandOf),
			['npm run test', 'ls']
		);
	});

	test('コマンドが取れないものは undefined', () => {
		assert.deepStrictEqual(
			[undefined, null, 'ls', { command: '' }, { command: 7 }, {}].map(commandOf),
			[undefined, undefined, undefined, undefined, undefined, undefined]
		);
	});

	test('空白だけのコマンドは空文字を返す（`undefined` ではない）', () => {
		// いまの実装の挙動をそのまま押さえる。空文字（`{ command: '' }`）は undefined を返すので
		// **ここだけ不揃い**だが、振る舞いを変えるかは別に決めることなので、ここでは固定するに留める。
		// 唯一の呼び出し元 `activity.ts` は `filePathOf(...) ?? commandOf(...)` で使うため、
		// undefined ではなく空文字が入ると、対象欄が「空」で出る（省かれない）。
		assert.strictEqual(commandOf({ command: '   ' }), '');
	});

	test('読む側と書く側が重なっていない（重なると同じ操作が二重に数えられる）', () => {
		assert.deepStrictEqual(
			{
				read: [...READ_TOOLS].sort(),
				write: [...WRITE_TOOLS].sort(),
				overlap: [...READ_TOOLS].filter((tool) => WRITE_TOOLS.has(tool))
			},
			{
				read: ['NotebookRead', 'Read'],
				write: ['Edit', 'MultiEdit', 'NotebookEdit', 'Write'],
				overlap: []
			}
		);
	});
});
