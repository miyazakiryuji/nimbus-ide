/**
 * 改善前後のベンチを比べる（tasks.md T-130）。
 *
 * 2 つの計測結果を貼って比べる。**ばらつきを超えた差だけを「速くなった」と言う** —
 * ここを緩めると、この機能は「改善したことにする道具」になる。
 *
 * 判断の本体は `core/benchmark.ts`（VS Code 非依存・単体テスト済み）。
 */
import * as vscode from 'vscode';
import { compareAll, formatComparison, parseMeasurements } from './core/benchmark';

/** 貼ってもらう。ファイルから読むより、端末の出力をそのまま貼れるほうが早い */
async function askFor(title: string): Promise<string | undefined> {
	const document = await vscode.workspace.openTextDocument({
		content: `# ${title}\n\n計測結果をここに貼って、タブを閉じずに次へ進んでください。\n\n例:\n起動: 120.5 ms\n描画: 98 ms\nスループット: 1500 ops/sec\n`,
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
	const OK = '貼りました';
	const answer = await vscode.window.showInformationMessage(
		`Nimbus: ${title}を貼ったら「貼りました」を押してください。`,
		{ modal: true },
		OK
	);
	return answer === OK ? document.getText() : undefined;
}

export async function compareBenchmarks(): Promise<void> {
	const beforeText = await askFor('改善前の計測');
	if (beforeText === undefined) {
		return;
	}
	const afterText = await askFor('改善後の計測');
	if (afterText === undefined) {
		return;
	}

	const before = parseMeasurements(beforeText);
	const after = parseMeasurements(afterText);
	if (before.length === 0 || after.length === 0) {
		void vscode.window.showWarningMessage(
			'Nimbus: 計測らしい行が読み取れませんでした（`名前: 12.3 ms` のような行を読んでいます）。'
		);
		return;
	}

	const document = await vscode.workspace.openTextDocument({
		content: formatComparison(compareAll(before, after)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
