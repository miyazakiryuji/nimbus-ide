/**
 * 競合マーカーの頭に「Claude に相談」を出す（tasks.md T-308）。
 *
 * コマンド「コンフリクトの解決を手伝う」は在ったのに、入口がコマンドパレットにしか
 * 無かった（T-294 と同じ原因）。**競合している、まさにその行**に出すのがいちばん近い。
 *
 * `<<<<<<<` を見て出すだけなので upstream には手を入れない。VS Code 標準の
 * merge-conflict 拡張が出す「現在の変更を取り込む …」は**置き換えず**、その隣に並ぶ。
 */
import * as vscode from 'vscode';

/** これより大きいファイルは走査しない（開くたびに全文を舐めるので） */
const MAX_SCAN_LENGTH = 2 * 1024 * 1024;

const MARKER = /^<{7}(\s|$)/;

export class ConflictLensProvider implements vscode.CodeLensProvider {
	provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
		const text = document.getText();
		if (text.length > MAX_SCAN_LENGTH || !text.includes('<<<<<<<')) {
			return [];
		}
		const lenses: vscode.CodeLens[] = [];
		const lines = text.split('\n');
		for (let line = 0; line < lines.length; line++) {
			if (MARKER.test(lines[line])) {
				lenses.push(
					new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
						title: '$(cloud) Claude に相談',
						tooltip: 'この競合の両側（diff3 なら分岐元も）を貼った相談文をコックピットへ送ります。返ってきた案は自分では書き戻しません。',
						command: 'nimbus.assistConflictAt',
						arguments: [document.uri, line]
					})
				);
			}
		}
		return lenses;
	}
}
