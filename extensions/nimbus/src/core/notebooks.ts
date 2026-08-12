/**
 * ノートブック（`.ipynb`）対応（tasks.md T-174）。
 *
 * ノートブックのセルは、VS Code から見ると `vscode-notebook-cell:` という**別のファイル**。
 * そのまま扱うと、git は「そんなファイルは無い」と言うし、
 * 場所を渡しても `main.ipynb` のどこなのかが伝わらない。
 *
 * ここに置くのは呼び方の判断だけ。実際の解決は `notebooks.ts`（VS Code の API が要る）。
 */

/** セルのエディタが持つ scheme */
export const NOTEBOOK_CELL_SCHEME = 'vscode-notebook-cell';

export function isNotebookCell(scheme: string): boolean {
	return scheme === NOTEBOOK_CELL_SCHEME;
}

/**
 * セルの場所の言い方。
 * **ファイル名とセル番号の両方**を出す — どちらが欠けても、人が開き直せない。
 * セル番号は 1 起点（画面の並びと同じ）。
 */
export function describeCell(notebookPath: string, index: number): string {
	return `${notebookPath}（セル ${index + 1}）`;
}

/**
 * ノートブックでは使えない機能を断る文。
 * **何ができないかではなく、代わりに何をすればよいか**を言う。
 */
export function notebookNotSupported(feature: string): string {
	return `${feature}はノートブックのセルでは使えません（セルは git の管理単位ではありません）。ノートブック全体を対象にしたいときは、エクスプローラで \`.ipynb\` を選んでから実行してください。`;
}
