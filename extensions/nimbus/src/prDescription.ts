/**
 * PR の説明文を作って開く（tasks.md T-220）。
 *
 * 比べる先は「ブランチのようす」と同じ決め方（設定 → main → master）。
 * テストの結果は分からないので空欄にする（嘘を書くより空のほうがいい）。
 */
import { execFile } from 'child_process';
import * as vscode from 'vscode';
import { groupCommits, parseCommitLog } from './core/releaseNotes';
import { parseNumstat, summarize } from './core/changeStats';
import { renderPrDescription } from './core/prDescription';

function git(args: string[], cwd: string): Promise<string | undefined> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout) =>
			resolve(error ? undefined : stdout.trim())
		);
	});
}

export async function draftPrDescription(): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'], root)) ?? '';
	const configured = vscode.workspace.getConfiguration('nimbus').get<string>('git.baseBranch');
	let base = configured && (await git(['rev-parse', '--verify', configured], root)) ? configured : undefined;
	for (const candidate of ['main', 'master']) {
		if (!base && (await git(['rev-parse', '--verify', candidate], root))) {
			base = candidate;
		}
	}
	if (!branch || !base) {
		void vscode.window.showInformationMessage('Nimbus: git の情報を読めませんでした。');
		return;
	}

	const log = (await git(['log', '--format=%h%x09%s', `${base}..HEAD`], root)) ?? '';
	const numstat = (await git(['diff', `${base}...HEAD`, '--numstat'], root)) ?? '';

	const markdown = renderPrDescription({
		branch,
		base,
		changes: groupCommits(parseCommitLog(log)),
		stats: summarize(parseNumstat(numstat))
	});

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
