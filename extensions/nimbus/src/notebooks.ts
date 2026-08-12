/**
 * ノートブックのセルを、ファイルとセル番号に解決する（tasks.md T-174）。
 *
 * `vscode-notebook-cell:` の URI をそのまま渡すと、git も表示も破綻する。
 * **どの `.ipynb` の、何番目のセルか**に直してから使う。
 */
import * as vscode from 'vscode';
import { isNotebookCell } from './core/notebooks';

export interface NotebookCell {
	/** ノートブック本体 */
	notebook: vscode.Uri;
	/** 0 起点のセル番号 */
	index: number;
}

/**
 * セルの URI から、ノートブックと番号を割り出す。
 * URI の中身は不透明なので**開いているノートブックから探す**（自前で解析しない）。
 */
export function resolveNotebookCell(uri: vscode.Uri): NotebookCell | undefined {
	if (!isNotebookCell(uri.scheme)) {
		return undefined;
	}
	for (const notebook of vscode.workspace.notebookDocuments) {
		const index = notebook.getCells().findIndex((cell) => cell.document.uri.toString() === uri.toString());
		if (index >= 0) {
			return { notebook: notebook.uri, index };
		}
	}
	return undefined;
}

/**
 * その URI が指す「実ファイル」。
 * セルならノートブック本体、それ以外はそのまま。git に渡すのはこちら。
 */
export function underlyingFile(uri: vscode.Uri): vscode.Uri {
	return resolveNotebookCell(uri)?.notebook ?? uri;
}
