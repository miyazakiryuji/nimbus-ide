/**
 * 過去セッションの横断検索（tasks.md T-034）の UI。
 *
 * 読むのは Claude Code 本体が書き出している `~/.claude/projects/**\/*.jsonl`。
 * **Nimbus は書き込まない**（他人の記録なので、読むだけにする）。
 *
 * 探し当てたら、その発言を読める形で開くところまでやる。
 * 見つかっても中身が読めないなら、探せていないのと同じ。
 *
 * 行の解釈・絞り込み・抜粋は `core/transcripts.ts`（VS Code 非依存）。
 */
import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import {
	formatTimestamp,
	parseQuery,
	parseTranscript,
	readSessionMeta,
	searchEntries,
	type SearchQuery,
	type TranscriptMatch,
	type TranscriptSessionMeta
} from './core/transcripts';

/** 1 ファイルあたりの読み込み上限。巨大な記録で拡張ホストを止めないための保険 */
const MAX_FILE_BYTES = 12 * 1024 * 1024;
/** 結果の上限。これを超えたら打ち切って、その旨を利用者に伝える */
const MAX_RESULTS = 300;

interface Hit {
	match: TranscriptMatch;
	meta: TranscriptSessionMeta;
	file: string;
}

function transcriptRoot(): string {
	return join(homedir(), '.claude', 'projects');
}

/** 新しい記録から先に見る（探しているのはたいてい最近のもの） */
async function listTranscripts(root: string): Promise<{ path: string; mtime: number }[]> {
	const files: { path: string; mtime: number }[] = [];
	let projects: string[];
	try {
		projects = await readdir(root);
	} catch {
		return [];
	}
	for (const project of projects) {
		const dir = join(root, project);
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith('.jsonl')) {
				continue;
			}
			const path = join(dir, entry);
			try {
				const info = await stat(path);
				files.push({ path, mtime: info.mtimeMs });
			} catch {
				continue;
			}
		}
	}
	return files.sort((a, b) => b.mtime - a.mtime);
}

async function searchFile(path: string, query: SearchQuery): Promise<Hit[]> {
	let content: string;
	try {
		const info = await stat(path);
		if (info.size > MAX_FILE_BYTES) {
			return [];
		}
		content = await readFile(path, 'utf8');
	} catch {
		return [];
	}
	const sessionId = path.split('/').pop()?.replace(/\.jsonl$/, '') ?? path;
	const meta: TranscriptSessionMeta = { sessionId };
	// 見出しは行ごとに拾う（同じファイルを 2 度読まないため）
	for (const line of content.split('\n')) {
		readSessionMeta(line, meta);
	}
	return searchEntries(parseTranscript(content), query, sessionId).map((match) => ({ match, meta, file: path }));
}

/** 本文が無い（ツール呼び出しだけの）当たりを 1 行にする */
function describeToolOnly(hit: Hit): string {
	const tools = hit.match.entry.tools.join(', ') || 'ツール実行';
	const first = hit.match.entry.files[0];
	return first ? `${tools} — ${first}` : tools;
}

/** 見つけた発言を読める形で開く。Markdown なのでプレビューでも読める */
async function openHit(hit: Hit): Promise<void> {
	const { entry } = hit.match;
	const body = [
		`# ${hit.meta.title ?? '（タイトルなし）'}`,
		'',
		`- セッション: \`${hit.meta.sessionId}\``,
		`- 記録: \`${hit.file}\``,
		hit.meta.cwd ? `- 作業ディレクトリ: \`${hit.meta.cwd}\`` : '',
		hit.meta.gitBranch ? `- ブランチ: \`${hit.meta.gitBranch}\`` : '',
		entry.timestamp ? `- 日時: ${formatTimestamp(entry.timestamp)}` : '',
		entry.tools.length > 0 ? `- 使ったツール: ${entry.tools.join(', ')}` : '',
		entry.files.length > 0 ? `- 触ったファイル:\n${entry.files.map((p) => `  - \`${p}\``).join('\n')}` : '',
		'',
		`## ${entry.role === 'user' ? '指示' : 'Claude の応答'}`,
		'',
		entry.text || '（本文なし・ツール呼び出しのみ）'
	]
		.filter((line) => line !== '')
		.join('\n');
	const document = await vscode.workspace.openTextDocument({ content: body, language: 'markdown' });
	await vscode.window.showTextDocument(document, { preview: true });
}

/**
 * 検索を走らせる。入力のたびに全記録を舐めると重いので、
 * **Enter を押してから**探す（QuickPick の逐次絞り込みではなく、明示的な検索）。
 */
export async function searchTranscripts(log: (message: string) => void): Promise<void> {
	const input = await vscode.window.showInputBox({
		title: 'Nimbus: 過去セッションを検索',
		prompt: '語を空白区切りで。file: と tool: で絞り込めます',
		placeHolder: '例: file:normalize.ts tool:Edit フック'
	});
	if (!input) {
		return;
	}
	const query = parseQuery(input);
	if (query.terms.length === 0 && !query.file && !query.tool) {
		void vscode.window.showInformationMessage('Nimbus: 検索語を入れてください。');
		return;
	}

	const hits = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: 過去セッションを検索しています', cancellable: true },
		async (progress, token) => {
			const files = await listTranscripts(transcriptRoot());
			const found: Hit[] = [];
			let scanned = 0;
			for (const file of files) {
				if (token.isCancellationRequested || found.length >= MAX_RESULTS) {
					break;
				}
				found.push(...(await searchFile(file.path, query)));
				scanned++;
				if (scanned % 20 === 0) {
					progress.report({ message: `${scanned} / ${files.length} 件の記録` });
				}
			}
			log(`[search] ${scanned} 件の記録を調べ、${found.length} 件見つかりました`);
			return found;
		}
	);

	if (hits.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 見つかりませんでした。');
		return;
	}

	// 新しい順。探しているのはたいてい最近のもの
	hits.sort((a, b) => (b.match.entry.timestamp ?? '').localeCompare(a.match.entry.timestamp ?? ''));
	const items = hits.slice(0, MAX_RESULTS).map((hit) => ({
		// ツールだけの発言は本文が空になる。そのまま出すと選べない行になるので、
		// 何をしたかを label に立てる（実測: tool: での検索は本文が空の当たりが大半）
		label: hit.match.snippet || describeToolOnly(hit),
		description: hit.meta.title ?? hit.meta.sessionId.slice(0, 8),
		detail: [
			hit.match.entry.role === 'user' ? '指示' : 'Claude',
			formatTimestamp(hit.match.entry.timestamp),
			hit.meta.gitBranch,
			hit.match.entry.tools.join(' '),
			hit.match.entry.files.join(' ')
		]
			.filter(Boolean)
			.join(' · '),
		hit
	}));

	const chosen = await vscode.window.showQuickPick(items, {
		title:
			hits.length > MAX_RESULTS
				// 打ち切ったことを黙っていると「これで全部」と誤解する
				? `Nimbus: ${MAX_RESULTS} 件まで表示（該当 ${hits.length} 件・語を足して絞ってください）`
				: `Nimbus: ${hits.length} 件`,
		matchOnDescription: true,
		matchOnDetail: true
	});
	if (chosen) {
		await openHit(chosen.hit);
	}
}
