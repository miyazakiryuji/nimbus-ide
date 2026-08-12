/**
 * ふりかえり（tasks.md T-207 週次ダイジェスト / T-047 成長ログ）。
 *
 * 何を作ったか・どこで詰まったかは、やっている最中には見えない。
 * 週の終わりに「自分が何をしたか」を数字で見られると、次の週の決め方が変わる。
 *
 * 集計元は Claude Code 本体が残している記録（`~/.claude/projects/**​/*.jsonl`）。
 * **推測はしない。** 記録に無いことは出さない（「たぶん頑張った」は書かない）。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { TranscriptEntry } from './transcripts';

export interface DigestInput {
	entries: readonly TranscriptEntry[];
	/** 集計の起点（この時刻以降のものだけ数える） */
	since: number;
}

export interface Digest {
	/** 自分が出した指示の数 */
	instructionCount: number;
	/** Claude の応答の数 */
	replyCount: number;
	/** よく使ったツール（多い順） */
	tools: { name: string; count: number }[];
	/** よく触ったファイル（多い順） */
	files: { path: string; count: number }[];
	/** 動いていた日（`YYYY-MM-DD`・古い順） */
	activeDays: string[];
}

function rank(counts: Map<string, number>, limit: number): { name: string; count: number }[] {
	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		.slice(0, limit);
}

/** 記録の時刻（ISO 文字列）を epoch に。取れないものは 0 */
function at(entry: TranscriptEntry): number {
	if (!entry.timestamp) {
		return 0;
	}
	const parsed = Date.parse(entry.timestamp);
	return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * ふりかえりを組み立てる。
 *
 * 時刻を持たない記録は**期間で切れない**ので数えない（古いものが混ざると数字が嘘になる）。
 */
export function buildDigest({ entries, since }: DigestInput, limit = 5): Digest {
	const tools = new Map<string, number>();
	const files = new Map<string, number>();
	const days = new Set<string>();
	let instructionCount = 0;
	let replyCount = 0;

	for (const entry of entries) {
		const time = at(entry);
		if (time === 0 || time < since) {
			continue;
		}
		days.add(new Date(time).toISOString().slice(0, 10));
		if (entry.role === 'user') {
			instructionCount++;
		} else {
			replyCount++;
		}
		for (const tool of entry.tools) {
			tools.set(tool, (tools.get(tool) ?? 0) + 1);
		}
		for (const file of entry.files) {
			files.set(file, (files.get(file) ?? 0) + 1);
		}
	}

	return {
		instructionCount,
		replyCount,
		tools: rank(tools, limit),
		files: rank(files, limit).map((f) => ({ path: f.name, count: f.count })),
		activeDays: [...days].sort()
	};
}

/** 表示用に短くする（フルパスは長すぎて読めない） */
export function shortenPath(path: string, root: string | undefined): string {
	if (root && path.startsWith(root + '/')) {
		return path.slice(root.length + 1);
	}
	const parts = path.split('/');
	return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : path;
}

/**
 * Markdown にする。
 * 数字を並べるだけにして、評価（よく頑張りました等）は書かない。
 * 見た人が自分で判断する材料になればいい。
 */
export function renderDigest(digest: Digest, root: string | undefined, days: number): string {
	const lines: string[] = [`# ふりかえり（直近 ${days} 日）`, ''];

	if (digest.instructionCount === 0 && digest.replyCount === 0) {
		lines.push('この期間の記録がありません。');
		return lines.join('\n') + '\n';
	}

	lines.push(
		`- 出した指示: **${digest.instructionCount} 件**`,
		`- 返ってきた応答: **${digest.replyCount} 件**`,
		`- 動いていた日: **${digest.activeDays.length} 日**（${digest.activeDays.join(' / ')}）`,
		''
	);

	if (digest.tools.length > 0) {
		lines.push('## よく使ったツール', '');
		for (const tool of digest.tools) {
			lines.push(`- ${tool.name} — ${tool.count} 回`);
		}
		lines.push('');
	}

	if (digest.files.length > 0) {
		lines.push('## よく触ったファイル', '');
		for (const file of digest.files) {
			lines.push(`- \`${shortenPath(file.path, root)}\` — ${file.count} 回`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
