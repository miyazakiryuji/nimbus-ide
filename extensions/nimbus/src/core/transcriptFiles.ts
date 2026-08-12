/**
 * 記録ファイル（`~/.claude/projects/…/*.jsonl`）を新しい順に読む。
 *
 * 同じ処理が `claudeMdView.ts`（繰り返しの検出）と `digest.ts`（ふりかえり）に
 * 二重に書かれていたのを 1 か所にまとめたもの。**「命名と重複」の道具（T-137）が
 * 自分の重複として検出したので直した**、という経緯がある。
 *
 * ファイル操作は注入できるようにしてあるので、拡張ホストなしで検証できる。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { parseTranscript, projectDirName, type TranscriptEntry } from './transcripts';

export interface TranscriptFileSystem {
	list: (dir: string) => string[];
	size: (path: string) => number;
	mtime: (path: string) => number;
	read: (path: string) => string;
}

export const nodeFileSystem: TranscriptFileSystem = {
	list: (dir) => readdirSync(dir),
	size: (path) => statSync(path).size,
	mtime: (path) => statSync(path).mtimeMs,
	read: (path) => readFileSync(path, 'utf8')
};

export interface ReadTranscriptsOptions {
	/** 見る記録の本数（新しい順） */
	limit: number;
	/** これより大きいファイルは飛ばす（開くだけで固まらせないため） */
	maxBytes: number;
	fs?: TranscriptFileSystem;
}

/**
 * 作業ディレクトリに対応する記録を、新しい順に読んで発言を返す。
 * 読めないもの・大きすぎるものは黙って飛ばす（記録は Nimbus のものではないので、
 * 1 本の異常で全部が止まらないようにする）。
 */
export function readRecentTranscripts(
	root: string,
	home: string,
	{ limit, maxBytes, fs = nodeFileSystem }: ReadTranscriptsOptions
): TranscriptEntry[] {
	const dir = join(home, '.claude', 'projects', projectDirName(root));
	let names: string[];
	try {
		names = fs.list(dir);
	} catch {
		return [];
	}

	const files: { path: string; mtime: number }[] = [];
	for (const name of names) {
		if (!name.endsWith('.jsonl')) {
			continue;
		}
		const path = join(dir, name);
		try {
			files.push({ path, mtime: fs.mtime(path) });
		} catch {
			continue;
		}
	}

	const entries: TranscriptEntry[] = [];
	for (const file of files.sort((a, b) => b.mtime - a.mtime).slice(0, limit)) {
		try {
			if (fs.size(file.path) > maxBytes) {
				continue;
			}
			entries.push(...parseTranscript(fs.read(file.path)));
		} catch {
			continue;
		}
	}
	return entries;
}
