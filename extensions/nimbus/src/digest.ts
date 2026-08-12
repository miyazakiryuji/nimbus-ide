/**
 * ふりかえりを開く（tasks.md T-207 週次ダイジェスト / T-047 成長ログ）。
 *
 * 何を作ったか・どこに時間を使ったかは、やっている最中には見えない。
 * 記録（Claude Code 本体が残す JSONL）から数えて、Markdown で開く。
 *
 * **Nimbus は記録に書き込まない。**読むだけ。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { buildDigest, renderDigest } from './core/digest';
import { parseTranscript, projectDirName, type TranscriptEntry } from './core/transcripts';

/** 1 ファイルの読み込み上限（大きな記録で固まらせない） */
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

/** 見る記録の本数の上限 */
const MAX_TRANSCRIPTS = 40;

const RANGES: { label: string; days: number; detail: string }[] = [
	{ label: '直近 7 日', days: 7, detail: '週のふりかえり' },
	{ label: '直近 30 日', days: 30, detail: '月のふりかえり' },
	{ label: '今日', days: 1, detail: '今日やったこと' }
];

function readEntries(root: string, home: string): TranscriptEntry[] {
	const dir = join(home, '.claude', 'projects', projectDirName(root));
	let files: { path: string; mtime: number }[];
	try {
		files = readdirSync(dir)
			.filter((name) => name.endsWith('.jsonl'))
			.map((name) => {
				const path = join(dir, name);
				return { path, mtime: statSync(path).mtimeMs };
			});
	} catch {
		return [];
	}
	const entries: TranscriptEntry[] = [];
	for (const file of files.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_TRANSCRIPTS)) {
		try {
			if (statSync(file.path).size > MAX_TRANSCRIPT_BYTES) {
				continue;
			}
			entries.push(...parseTranscript(readFileSync(file.path, 'utf8')));
		} catch {
			continue;
		}
	}
	return entries;
}

export async function openDigest(home: string = homedir()): Promise<void> {
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (!root) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const range = await vscode.window.showQuickPick(RANGES, { title: 'Nimbus: ふりかえり' });
	if (!range) {
		return;
	}

	const entries = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 記録を読んでいます' },
		async () => readEntries(root, home)
	);

	// 「いま」を基準に遡る。記録の側の時刻は使わない（読んだ人が見ている日付と合わせる）
	const since = Date.now() - range.days * 24 * 60 * 60 * 1000;
	const markdown = renderDigest(buildDigest({ entries, since }), root, range.days);

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
