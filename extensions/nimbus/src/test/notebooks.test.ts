/**
 * ノートブック対応。
 *
 * セルは VS Code から見ると別のファイルなので、そのまま扱うと
 * git も表示も破綻する。**言い方**をここで固定する。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { describeCell, isNotebookCell, notebookNotSupported, NOTEBOOK_CELL_SCHEME } from '../core/notebooks';

test('セルの scheme を見分ける', () => {
	assert.deepStrictEqual([NOTEBOOK_CELL_SCHEME, 'file', 'untitled'].map(isNotebookCell), [true, false, false]);
});

test('場所はファイル名とセル番号の両方を出す（番号は 1 起点）', () => {
	assert.strictEqual(describeCell('notebooks/main.ipynb', 0), 'notebooks/main.ipynb（セル 1）');
	assert.strictEqual(describeCell('main.ipynb', 4), 'main.ipynb（セル 5）');
});

test('断るときは、代わりにどうすればよいかを言う', () => {
	const message = notebookNotSupported('履歴を辿る機能');
	assert.ok(message.startsWith('履歴を辿る機能はノートブックのセルでは使えません'), message);
	assert.ok(message.includes('`.ipynb` を選んでから実行してください'), message);
});
