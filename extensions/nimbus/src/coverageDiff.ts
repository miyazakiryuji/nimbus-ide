/**
 * 「この変更で増えた行は、テストされているか」を出す（tasks.md T-109）。
 *
 * 全体のカバレッジ率は、上がっても下がっても誰も動かない。効くのは差分の側。
 * Test Explorer がカバレッジを報告していれば、その情報はもう手元にある。
 *
 * 突き合わせは `core/coverage.ts` に置き、ここは git と VS Code の口だけを持つ。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import {
	buildCoveragePrompt,
	parseAddedLines,
	renderCoverageDiff,
	uncoveredAmong,
	type CoverageEntry
} from './core/coverage';

export interface CoverageDiffDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function run(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) => {
			if (error) {
				reject(error);
				return;
			}
			resolve(stdout);
		});
	});
}

/**
 * 直近のテスト実行のカバレッジと、`HEAD` からの差分を突き合わせる。
 * カバレッジを報告していない実行しかなければ、そう言って終わる（黙って空を出さない）。
 */
export async function showCoverageDiff(deps: CoverageDiffDeps): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showErrorMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}
	const latest = vscode.tests.testResults?.[0];
	if (!latest?.getDetailedCoverage) {
		void vscode.window.showInformationMessage(
			'Nimbus: カバレッジを計測した実行が見つかりません。テストを「カバレッジつきで実行」してから、もう一度実行してください。'
		);
		return;
	}

	let diff: string;
	try {
		// -U0 で呼ぶと hunk の見出しだけで足された行が分かる
		diff = await run(folder.uri.fsPath, ['diff', '-U0', 'HEAD']);
	} catch (error) {
		deps.log(`[coverage] 差分を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: git の差分を取得できませんでした。');
		return;
	}

	const added = parseAddedLines(diff);
	if (added.size === 0) {
		void vscode.window.showInformationMessage('Nimbus: HEAD からの変更がありません。');
		return;
	}

	const entries: CoverageEntry[] = [];
	for (const [relative, lines] of added) {
		const uri = vscode.Uri.joinPath(folder.uri, relative);
		let details: readonly vscode.FileCoverageDetail[];
		try {
			details = await latest.getDetailedCoverage(uri);
		} catch {
			// カバレッジを持たないファイル（テストの対象外）は静かに飛ばす
			continue;
		}
		const executedByLine = new Map<number, boolean>();
		for (const detail of details) {
			const location = detail.location;
			const start = 'start' in location ? location.start.line : location.line;
			const end = 'end' in location ? location.end.line : location.line;
			const executed = typeof detail.executed === 'number' ? detail.executed > 0 : detail.executed;
			for (let line = start; line <= end; line++) {
				// 1 起点に揃える（git の行番号と合わせる）。同じ行に複数の文があれば「1 つでも実行された」を採る
				const key = line + 1;
				executedByLine.set(key, (executedByLine.get(key) ?? false) || executed);
			}
		}
		if (executedByLine.size === 0) {
			continue;
		}
		const { uncovered, measured } = uncoveredAmong(lines, executedByLine);
		entries.push({ file: relative, added: lines, uncovered, measured });
	}

	const summary = renderCoverageDiff(entries);
	deps.log(`[coverage] ${summary.split('\n')[0]}`);
	const prompt = buildCoveragePrompt(entries);
	if (!prompt) {
		void vscode.window.showInformationMessage(`Nimbus: ${summary}`);
		return;
	}

	const SEND = 'テストを書かせる';
	const choice = await vscode.window.showWarningMessage(`Nimbus: ${summary.split('\n')[0]}`, { detail: summary, modal: false }, SEND);
	if (choice === SEND) {
		deps.send(prompt);
	}
}
