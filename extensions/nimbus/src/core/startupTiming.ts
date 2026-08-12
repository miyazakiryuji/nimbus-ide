/**
 * 起動時間の計測（tasks.md T-222）。
 *
 * 起動が遅くなるのは**一度に遅くなるのではなく、少しずつ遅くなる**。
 * 毎回測っていれば気づくが、誰も毎回は測らない。だから前回の値を覚えておいて、比べる。
 *
 * Flutter の `flutter run --trace-startup` が吐く `start_up_info.json` を読む
 * （マイクロ秒。キーは `timeToFirstFrameMicros` など）。
 * 同じ形なら他のツールの出力でも読める。
 *
 * VS Code に依存しない。
 */

export interface StartupMeasure {
	/** 計測の名前（`timeToFirstFrameMicros` → `first frame`） */
	name: string;
	/** ミリ秒 */
	ms: number;
}

const LABELS: Record<string, string> = {
	engineEnterTimestampMicros: 'エンジン開始',
	timeToFrameworkInitMicros: 'フレームワーク初期化',
	timeToFirstFrameRasterizedMicros: '最初のフレーム（描画完了）',
	timeToFirstFrameMicros: '最初のフレーム',
	timeAfterFrameworkInitMicros: 'フレームワーク初期化のあと'
};

/**
 * `start_up_info.json` を読む。
 *
 * **絶対時刻は落とす。** `engineEnterTimestampMicros` は起動の速さではなく
 * 「いつ起動したか」なので、比べても意味がない。
 */
export function parseStartupInfo(json: string): StartupMeasure[] {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (typeof raw !== 'object' || raw === null) {
		return [];
	}
	const measures: StartupMeasure[] = [];
	for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof value !== 'number' || key === 'engineEnterTimestampMicros') {
			continue;
		}
		measures.push({ name: LABELS[key] ?? key, ms: Math.round(value / 1000) });
	}
	return measures.sort((a, b) => b.ms - a.ms);
}

export interface StartupChange {
	name: string;
	before: number;
	after: number;
	deltaMs: number;
	/** 前回比。1.0 で変わらず */
	ratio: number;
}

/** 前回との差。**遅くなった順**に並べる */
export function compareStartup(
	before: readonly StartupMeasure[],
	after: readonly StartupMeasure[]
): StartupChange[] {
	const previous = new Map(before.map((measure) => [measure.name, measure.ms]));
	const changes: StartupChange[] = [];
	for (const measure of after) {
		const was = previous.get(measure.name);
		if (was === undefined) {
			continue;
		}
		changes.push({
			name: measure.name,
			before: was,
			after: measure.ms,
			deltaMs: measure.ms - was,
			ratio: was > 0 ? measure.ms / was : Infinity
		});
	}
	return changes.sort((a, b) => b.deltaMs - a.deltaMs);
}

/**
 * 騒ぐ価値があるか。
 *
 * **ぶれで騒がない。** 起動時間は毎回 1 割くらいは動くので、
 * 20% 以上かつ 100ms 以上遅くなったものだけを「遅くなった」と言う。
 */
export function regressions(changes: readonly StartupChange[]): StartupChange[] {
	return changes.filter((change) => change.ratio >= 1.2 && change.deltaMs >= 100);
}

/** 画面に出す一覧 */
export function describeStartup(measures: readonly StartupMeasure[]): string {
	if (measures.length === 0) {
		return '起動の計測結果を読めませんでした。';
	}
	return [
		`起動の計測 ${measures.length} 件`,
		...measures.map((measure) => `  ${measure.name}: ${measure.ms} ms`)
	].join('\n');
}

/** 前回と比べた一覧 */
export function describeComparison(changes: readonly StartupChange[]): string {
	if (changes.length === 0) {
		return '前回と比べられる計測がありません。';
	}
	const slower = regressions(changes);
	const head =
		slower.length > 0
			? `前回より遅くなったもの ${slower.length} 件`
			: '前回より目立って遅くなったものはありません';
	return [
		head,
		...changes.map(
			(change) =>
				`  ${change.name}: ${change.before} → ${change.after} ms（${change.deltaMs >= 0 ? '+' : ''}${change.deltaMs}）`
		)
	].join('\n');
}

/** セッションへ投入する文。**遅くなったものだけ**を渡す */
export function buildStartupPrompt(changes: readonly StartupChange[], sinceLabel: string): string {
	const slower = regressions(changes);
	if (slower.length === 0) {
		return '';
	}
	return [
		`起動が遅くなりました（${sinceLabel} と比べて）。**何が増えたか**を見てください。`,
		'',
		...slower.map((change) => `- ${change.name}: ${change.before} → ${change.after} ms（+${change.deltaMs}）`),
		'',
		'見てほしいこと:',
		'',
		'- 起動の経路に**同期の処理**（ファイル読み込み・ネットワーク待ち）が増えていないか',
		'- 起動時に読む必要のないものを読んでいないか（遅らせられないか）',
		'- **測り直す前に直さないでください。** 1 回の計測はぶれます'
	].join('\n');
}
