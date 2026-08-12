/**
 * セッションを、あとから追えるようにする（tasks.md T-206 リプレイ再生）。
 *
 * 記録をそのまま読むと、**間が抜け落ちる**。「ここで 8 分止まっていた」「ここは 3 秒で
 * 3 ファイル触った」は、時間の情報が無いと分からない。詰まった場所を探すときに効くのは、
 * 中身より**間隔**のほうだったりする。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { TranscriptEntry } from './transcripts';

export interface ReplayStep {
	index: number;
	role: 'user' | 'assistant';
	text: string;
	at?: number;
	/** 前のステップからの間（ミリ秒）。最初は undefined */
	gap?: number;
	files: string[];
	tools: string[];
}

/** これ以上空いていたら「止まっていた」とみなす */
const STALL = 3 * 60 * 1000;

export function buildReplay(entries: readonly TranscriptEntry[]): ReplayStep[] {
	const timed = entries
		.filter((entry) => entry.text.trim().length > 0 || entry.tools.length > 0)
		.map((entry) => ({
			...entry,
			at: entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN
		}))
		.filter((entry) => !Number.isNaN(entry.at))
		.sort((a, b) => a.at - b.at);

	return timed.map((entry, index) => ({
		index,
		role: entry.role,
		text: entry.text.trim(),
		at: entry.at,
		gap: index === 0 ? undefined : entry.at - timed[index - 1].at,
		files: entry.files,
		tools: entry.tools
	}));
}

/** 止まっていたところ（間が空いたステップ） */
export function stalls(steps: readonly ReplayStep[], threshold = STALL): ReplayStep[] {
	return steps.filter((step) => (step.gap ?? 0) >= threshold);
}

export function formatGap(gap: number | undefined): string {
	if (gap === undefined) {
		return '';
	}
	if (gap < 1000) {
		return '即';
	}
	if (gap < 60_000) {
		return `${Math.round(gap / 1000)} 秒後`;
	}
	return `${Math.round(gap / 60_000)} 分後`;
}

/** 1 行の見出し（一覧から選ぶときに使う） */
export function stepLabel(step: ReplayStep): string {
	const head = step.text.split('\n')[0].slice(0, 50) || step.tools.join(' / ') || '（本文なし）';
	return `${step.role === 'user' ? '指示' : 'Claude'}: ${head}`;
}

export function renderReplay(steps: readonly ReplayStep[]): string {
	if (steps.length === 0) {
		return '# たどり直す\n\n時刻つきの記録がありませんでした。\n';
	}

	const stalled = stalls(steps);
	const lines = [
		'# たどり直す',
		'',
		`${steps.length} ステップ。**間隔も一緒に出します**（詰まった場所は、中身より間隔に出ます）。`,
		''
	];

	if (stalled.length > 0) {
		lines.push('## 止まっていたところ', '');
		for (const step of stalled) {
			lines.push(`- ${formatGap(step.gap)} — ${stepLabel(step)}`);
		}
		lines.push('');
	}

	lines.push('## 順に', '');
	for (const step of steps) {
		const gap = step.gap === undefined ? '' : `（${formatGap(step.gap)}）`;
		lines.push(`### ${step.index + 1}. ${step.role === 'user' ? '指示' : 'Claude'}${gap}`, '');
		if (step.text) {
			lines.push(step.text.length > 800 ? step.text.slice(0, 800) + '…' : step.text, '');
		}
		if (step.files.length > 0 || step.tools.length > 0) {
			const parts = [
				step.tools.length > 0 ? `ツール: ${step.tools.join(' / ')}` : '',
				step.files.length > 0 ? `ファイル: ${step.files.join(' / ')}` : ''
			].filter(Boolean);
			lines.push(`_${parts.join('　')}_`, '');
		}
	}

	return lines.join('\n');
}
