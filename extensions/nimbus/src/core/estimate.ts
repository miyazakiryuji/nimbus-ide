/**
 * 見積もり表示（tasks.md T-187）。
 *
 * 「何ファイル・何分・何トークンくらい」を着手前に知りたい。
 * ただし**未来は予測できない**ので、予測のふりはしない。
 * このセッションで**実際に起きたことの中央値**を出し、「これまではこうだった」と言う。
 *
 * 平均ではなく中央値を使うのは、1 回の長いターンに引きずられないため。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { buildAttributions } from './activity';

export interface TurnSample {
	/** その指示で書き換えたファイル数 */
	files: number;
	/** そのターンの所要（ミリ秒） */
	durationMs: number;
	/** そのターンの入出力トークン */
	tokens: number;
}

export interface Estimate {
	/** もとにしたターン数。少ないと当てにならないので必ず見せる */
	samples: number;
	files?: number;
	durationMs?: number;
	tokens?: number;
}

/** 中央値。空なら undefined（0 と区別する） */
export function median(values: readonly number[]): number | undefined {
	if (values.length === 0) {
		return undefined;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * このセッションのターンから標本を作る。
 * 指示ごとの書き換え数（T-024 の結果）と、ターンの所要・トークンを突き合わせる。
 */
export function collectSamples(events: readonly NimbusEvent[]): TurnSample[] {
	// 指示ごとの書き換え数（古い順に戻す）
	const edits = [...buildAttributions(events)].reverse().map((attribution) => attribution.edits.length);
	const samples: TurnSample[] = [];
	let index = 0;
	for (const event of events) {
		if (event.kind !== 'turn-result') {
			continue;
		}
		const usage = event.usage;
		samples.push({
			files: edits[index] ?? 0,
			durationMs: event.durationMs,
			tokens: usage ? usage.inputTokens + usage.outputTokens : 0
		});
		index++;
	}
	return samples;
}

/** 直近のターンだけを見る。古い傾向を引きずらない */
const RECENT = 5;

export function estimate(events: readonly NimbusEvent[]): Estimate {
	const samples = collectSamples(events).slice(-RECENT);
	return {
		samples: samples.length,
		files: median(samples.map((sample) => sample.files)),
		durationMs: median(samples.map((sample) => sample.durationMs)),
		tokens: median(samples.filter((sample) => sample.tokens > 0).map((sample) => sample.tokens))
	};
}

function formatDuration(ms: number): string {
	if (ms < 60_000) {
		return `${Math.round(ms / 1000)} 秒`;
	}
	return `${Math.round(ms / 60_000)} 分`;
}

/**
 * 言葉にする。**「これまではこうだった」としか言わない** —
 * 「こうなります」と言うと、外れたときに信用を失う。
 */
export function describeEstimate(value: Estimate): string {
	if (value.samples === 0) {
		return 'まだ標本がありません（1 ターン終わると出せます）';
	}
	const parts = [
		value.files !== undefined ? `${value.files} ファイル` : '',
		value.durationMs !== undefined ? formatDuration(value.durationMs) : '',
		value.tokens !== undefined ? `${Math.round(value.tokens / 1000)}k トークン` : ''
	].filter(Boolean);
	return `直近 ${value.samples} ターンの中央値: ${parts.join(' · ')}`;
}
