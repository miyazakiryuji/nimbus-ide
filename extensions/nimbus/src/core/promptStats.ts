/**
 * 自分の指示の出しかたを観測する（tasks.md T-065 成功率 / T-067 癖の可視化）。
 *
 * 「うまく伝わらなかった」は、そのときは相手（エージェント）のせいに見える。
 * でも記録を並べると、**言い直しが起きやすい指示の形**と**起きにくい形**が分かれて見える。
 *
 * ここで測るのは「言い直しが起きたか」だけ。**うまくいったかどうかは測れない**
 * （満足したかは記録に出ない）。分かることだけを、分かる形で出す。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { TranscriptEntry } from './transcripts';

/** 言い直しの合図。**やり直しを頼んでいる**ときに出る言葉 */
const REDO_WORDS = [
	'違う',
	'ちがう',
	'そうじゃ',
	'やり直',
	'戻して',
	'元に戻',
	'間違',
	'じゃなくて',
	'ではなく',
	'直して',
	'まだ'
];

/** 言い直しとみなす時間の上限。離れていれば別の話題 */
const REDO_WINDOW = 10 * 60 * 1000;

export interface PromptSample {
	text: string;
	at: number;
	/** 直後に言い直しが来たか */
	redone: boolean;
	/** ファイル名や記号を含む（具体的な指示か） */
	specific: boolean;
	length: number;
}

function isRedo(text: string): boolean {
	return REDO_WORDS.some((word) => text.includes(word));
}

/** ファイル名・パス・記号を含むか。「あれ」「それ」だけの指示と区別する */
export function isSpecific(text: string): boolean {
	return /[\w-]+\.(ts|tsx|js|dart|md|json|ya?ml)|\/|`[^`]+`|#\d+|T-\d{3}/.test(text);
}

/**
 * 指示を並べ、直後に言い直しが来たかを見る。
 *
 * **最後の指示は数えない**（そのあとがまだ無いので、判定できない）。
 */
export function collectPrompts(entries: readonly TranscriptEntry[]): PromptSample[] {
	const prompts = entries
		.filter((entry) => entry.role === 'user' && entry.text.trim().length > 0 && entry.timestamp)
		.map((entry) => ({ text: entry.text.trim(), at: Date.parse(entry.timestamp as string) }))
		.filter((entry) => !Number.isNaN(entry.at))
		.sort((a, b) => a.at - b.at);

	const samples: PromptSample[] = [];
	for (let i = 0; i < prompts.length - 1; i++) {
		const current = prompts[i];
		const next = prompts[i + 1];
		samples.push({
			text: current.text,
			at: current.at,
			redone: next.at - current.at <= REDO_WINDOW && isRedo(next.text),
			specific: isSpecific(current.text),
			length: current.text.length
		});
	}
	return samples;
}

export interface PromptStats {
	total: number;
	redone: number;
	/** 具体的な指示／そうでない指示の、それぞれの言い直し率 */
	specificRedoRate?: number;
	vagueRedoRate?: number;
	/** 言い直しが起きた時間帯（0-23 時 → 件数） */
	byHour: { hour: number; redone: number; total: number }[];
	/** 言い直しの多かった長さの帯 */
	shortRedoRate?: number;
	longRedoRate?: number;
}

const LONG_ENOUGH = 60;

function rate(samples: readonly PromptSample[]): number | undefined {
	return samples.length === 0 ? undefined : samples.filter((sample) => sample.redone).length / samples.length;
}

export function summarizePrompts(samples: readonly PromptSample[]): PromptStats {
	const byHour = Array.from({ length: 24 }, (_, hour) => {
		const inHour = samples.filter((sample) => new Date(sample.at).getHours() === hour);
		return { hour, total: inHour.length, redone: inHour.filter((sample) => sample.redone).length };
	}).filter((entry) => entry.total > 0);

	return {
		total: samples.length,
		redone: samples.filter((sample) => sample.redone).length,
		specificRedoRate: rate(samples.filter((sample) => sample.specific)),
		vagueRedoRate: rate(samples.filter((sample) => !sample.specific)),
		shortRedoRate: rate(samples.filter((sample) => sample.length < LONG_ENOUGH)),
		longRedoRate: rate(samples.filter((sample) => sample.length >= LONG_ENOUGH)),
		byHour
	};
}

function percent(value: number | undefined): string {
	return value === undefined ? '—' : `${Math.round(value * 100)}%`;
}

export function renderPromptStats(stats: PromptStats): string {
	if (stats.total < 10) {
		return [
			'# 指示の出しかた',
			'',
			`まだ ${stats.total} 件しかありません。**傾向を出すには少なすぎます。**`,
			'（数が少ないうちに傾向を出すと、たまたまを法則だと思ってしまいます）',
			''
		].join('\n');
	}

	const lines = [
		'# 指示の出しかた',
		'',
		`- 見た指示: **${stats.total} 件**`,
		`- 直後に言い直したもの: **${stats.redone} 件**（${percent(stats.redone / stats.total)}）`,
		'',
		'## 形による違い',
		'',
		`| 形 | 言い直し率 |`,
		`| --- | --- |`,
		`| ファイル名や記号を含む | ${percent(stats.specificRedoRate)} |`,
		`| 含まない | ${percent(stats.vagueRedoRate)} |`,
		`| 短い（60 字未満） | ${percent(stats.shortRedoRate)} |`,
		`| 長い | ${percent(stats.longRedoRate)} |`,
		''
	];

	const busy = [...stats.byHour].sort((a, b) => b.redone / b.total - a.redone / a.total)[0];
	if (busy && busy.total >= 3) {
		lines.push(
			'## 時間帯',
			'',
			`言い直しがいちばん多いのは **${busy.hour} 時台**（${busy.redone} / ${busy.total}）。`,
			''
		);
	}

	lines.push(
		'---',
		'',
		'**測っているのは「言い直しが起きたか」だけです。** うまくいったかどうかは記録に出ないので、',
		'この数字は「伝わりやすさ」の目安であって、成果の評価ではありません。',
		''
	);
	return lines.join('\n');
}
