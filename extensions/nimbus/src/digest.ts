/**
 * ふりかえりを開く（tasks.md T-207 週次ダイジェスト / T-047 成長ログ）。
 *
 * 何を作ったか・どこに時間を使ったかは、やっている最中には見えない。
 * 記録（Claude Code 本体が残す JSONL）から数えて、Markdown で開く。
 *
 * **Nimbus は記録に書き込まない。**読むだけ。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { buildDigest, renderDigest } from './core/digest';
import { readRecentTranscripts } from './core/transcriptFiles';

/** 1 ファイルの読み込み上限（大きな記録で固まらせない） */
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

/** 見る記録の本数の上限 */
const MAX_TRANSCRIPTS = 40;

const RANGES: { label: string; days: number; detail: string }[] = [
	// 夜に仕込んで朝に受け取る使い方（T-052）。1 日だと昨夜ぶんが落ちるので 0.5 日にしてある
	{ label: '昨夜から', days: 0.5, detail: '寝ている間に動いていたぶん' },
	{ label: '直近 7 日', days: 7, detail: '週のふりかえり' },
	{ label: '直近 30 日', days: 30, detail: '月のふりかえり' },
	{ label: '今日', days: 1, detail: '今日やったこと' }
];

export async function openDigest(home: string = homedir()): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	const range = await vscode.window.showQuickPick(RANGES, { title: 'Nimbus: ふりかえり' });
	if (!range) {
		return;
	}

	const entries = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Window, title: 'Nimbus: 記録を読んでいます' },
		async () => readRecentTranscripts(root, home, { limit: MAX_TRANSCRIPTS, maxBytes: MAX_TRANSCRIPT_BYTES })
	);

	// 「いま」を基準に遡る。記録の側の時刻は使わない（読んだ人が見ている日付と合わせる）
	const since = Date.now() - range.days * 24 * 60 * 60 * 1000;
	const markdown = renderDigest(buildDigest({ entries, since }), root, range.days);

	const document = await vscode.workspace.openTextDocument({ content: markdown, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: false });
}
