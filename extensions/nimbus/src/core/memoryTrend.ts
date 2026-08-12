/**
 * メモリリークの調査支援（tasks.md T-222）。
 *
 * リークは**その瞬間のスナップショット 1 枚では分からない**。「200MB 使っている」だけでは
 * 多いのか漏れているのか判断できず、ヒープダンプを開いても何が異常か分からないまま時間が溶ける。
 *
 * リークの正体は「**増え続けていて、戻らない**」こと。だから見るのは 1 枚ではなく**並び**。
 * 同じ操作を繰り返しながら測った値の列があれば、増え続けているかどうかは機械的に言える。
 *
 * ここでやるのは**判定まで**。原因の特定はエージェントに渡す（そのための材料を整える）。
 *
 * VS Code に依存しない。
 */

export interface Sample {
	/** 何回目の計測か */
	index: number;
	/** バイト */
	bytes: number;
	label?: string;
}

/**
 * 計測の列を読む。次のどれでも読める:
 *
 * - `12345678`（1 行 1 数値）
 * - `heapUsed=12345678` / `rss: 12.3 MB`
 * - `[{"heapUsed": 12345678}, ...]`（JSON の配列）
 *
 * **単位の付いた数はバイトに直す。** MB と B を混ぜて比べるのがいちばん危ない。
 */
export function parseSamples(text: string): Sample[] {
	const trimmed = text.trim();
	if (trimmed.startsWith('[')) {
		return parseJsonSamples(trimmed);
	}
	const samples: Sample[] = [];
	for (const line of trimmed.split('\n')) {
		const bytes = bytesIn(line);
		if (bytes !== undefined) {
			samples.push({ index: samples.length, bytes, label: labelIn(line) });
		}
	}
	return samples;
}

function parseJsonSamples(text: string): Sample[] {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	const samples: Sample[] = [];
	for (const entry of raw) {
		if (typeof entry === 'number') {
			samples.push({ index: samples.length, bytes: entry });
			continue;
		}
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const value = record.heapUsed ?? record.rss ?? record.bytes ?? record.value;
		if (typeof value === 'number') {
			samples.push({
				index: samples.length,
				bytes: value,
				label: typeof record.label === 'string' ? record.label : undefined
			});
		}
	}
	return samples;
}

const UNITS: Record<string, number> = {
	b: 1,
	kb: 1024,
	k: 1024,
	mb: 1024 * 1024,
	m: 1024 * 1024,
	gb: 1024 * 1024 * 1024,
	g: 1024 * 1024 * 1024
};

function bytesIn(line: string): number | undefined {
	const match = line.match(/(?<value>\d+(?:\.\d+)?)\s*(?<unit>[kmg]?b?)\b/i);
	if (!match?.groups) {
		return undefined;
	}
	const value = Number(match.groups.value);
	if (!Number.isFinite(value)) {
		return undefined;
	}
	const unit = match.groups.unit.toLowerCase();
	return Math.round(value * (UNITS[unit] ?? 1));
}

function labelIn(line: string): string | undefined {
	const match = line.match(/^\s*(?<label>[\w.\-/]+)\s*[=:]/);
	return match?.groups?.label;
}

export interface Trend {
	samples: Sample[];
	first: number;
	last: number;
	peak: number;
	/** 1 回あたりの増分（バイト） */
	perSample: number;
	/** 一度も減らずに増え続けたか */
	monotonic: boolean;
	/** 最後が最初の何倍か */
	ratio: number;
}

/** 増え方を測る。**3 点未満では何も言わない**（2 点は傾きでしかない） */
export function measureTrend(samples: readonly Sample[]): Trend | undefined {
	if (samples.length < 3) {
		return undefined;
	}
	const first = samples[0].bytes;
	const last = samples[samples.length - 1].bytes;
	let monotonic = true;
	let peak = first;
	for (let index = 1; index < samples.length; index++) {
		if (samples[index].bytes < samples[index - 1].bytes) {
			monotonic = false;
		}
		peak = Math.max(peak, samples[index].bytes);
	}
	return {
		samples: [...samples],
		first,
		last,
		peak,
		perSample: Math.round((last - first) / (samples.length - 1)),
		monotonic,
		ratio: first > 0 ? last / first : Infinity
	};
}

export type LeakVerdict = 'leaking' | 'suspicious' | 'stable';

/**
 * 漏れていそうかを言う。
 *
 * **「漏れている」と言い切るのは、一度も減らずに 1.5 倍以上になったときだけ。**
 * GC は好きなときに走るので、途中で減っていれば「増え続けている」とは言えない。
 * 疑わしいものは `suspicious` に留めて、判断の材料を出す。
 */
export function judgeLeak(trend: Trend): LeakVerdict {
	if (trend.monotonic && trend.ratio >= 1.5) {
		return 'leaking';
	}
	if (trend.ratio >= 1.2 || (trend.monotonic && trend.perSample > 0)) {
		return 'suspicious';
	}
	return 'stable';
}

/** 人が読む単位に直す */
export function formatBytes(bytes: number): string {
	const megabytes = bytes / (1024 * 1024);
	if (Math.abs(megabytes) >= 1) {
		return `${megabytes.toFixed(1)} MB`;
	}
	return `${(bytes / 1024).toFixed(1)} KB`;
}

const VERDICT_LABEL: Record<LeakVerdict, string> = {
	leaking: '増え続けています（漏れている可能性が高い）',
	suspicious: '増えていますが、断定はできません',
	stable: '増え続けてはいません'
};

/** 画面に出す要約 */
export function describeTrend(trend: Trend): string {
	const verdict = judgeLeak(trend);
	return [
		`${trend.samples.length} 回の計測: ${VERDICT_LABEL[verdict]}`,
		`  ${formatBytes(trend.first)} → ${formatBytes(trend.last)}（山 ${formatBytes(trend.peak)}・1 回あたり ${formatBytes(trend.perSample)}）`,
		trend.monotonic ? '  一度も減っていません' : '  途中で減っています（GC は効いています）'
	].join('\n');
}

/**
 * セッションへ投入する文。
 *
 * **数字だけを渡して、原因は決めつけない。**
 * 「どこが漏れているか」はコードを読まないと分からないし、
 * こちらが当たりを付けて渡すと、そこから離れられなくなる。
 */
export function buildLeakPrompt(trend: Trend, context?: string): string {
	const verdict = judgeLeak(trend);
	if (verdict === 'stable') {
		return '';
	}
	return [
		'同じ操作を繰り返しながらメモリを測りました。**増え続けていないか**を見てください。',
		'',
		'```',
		...trend.samples.map((sample) => `${sample.index + 1}: ${formatBytes(sample.bytes)}${sample.label ? ` (${sample.label})` : ''}`),
		'```',
		'',
		describeTrend(trend),
		...(context ? ['', `繰り返した操作: ${context}`] : []),
		'',
		'見てほしいこと:',
		'',
		'- **解放し忘れている購読・タイマー・リスナー**がないか（`dispose` / `removeListener` / `cancel`）',
		'- 増え続けているなら、**その操作で作られて捨てられていないもの**は何か',
		'- 心当たりがなければ「無い」と言ってください。**それらしい原因を作らないでください**'
	].join('\n');
}
