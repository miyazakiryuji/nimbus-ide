/**
 * 使用量の見せかた（tasks.md T-017 / T-020 / T-037 / T-059）。
 *
 * 「いまどれだけ使ったか」は、走らせている最中に見えないと意味がない。
 * 終わってから請求で気づくのでは遅い。数字を**そのまま出さず**、枠に対する割合と
 * リセットまでの時間に変換するのがここの役目。
 *
 * SDK にも VS Code にも依存しない（構造だけを受け取る）ので単体で検証できる。
 */

/** 枠 1 つぶんの消費。SDK の rate_limits の各項目と構造互換 */
export interface UsageWindow {
	/** 枠の消費率 0〜100。取れないときは null */
	utilization: number | null;
	/** ISO 8601 のリセット時刻。取れないときは null */
	resets_at: string | null;
}

/** SDK の rate_limits と構造互換（必要な枠だけを並べる） */
export interface RateLimitWindows {
	five_hour?: UsageWindow | null;
	seven_day?: UsageWindow | null;
	seven_day_oauth_apps?: UsageWindow | null;
	seven_day_opus?: UsageWindow | null;
	seven_day_sonnet?: UsageWindow | null;
}

/** 画面に出すゲージ 1 本 */
export interface Gauge {
	label: string;
	/** 0〜100。取れないときは undefined */
	percent?: number;
	/** 文字で描いたバー。等幅でなくても長さで伝わる */
	bar: string;
	/** バーの右に出す一言（リセットまでの時間など） */
	detail: string;
}

const BAR_WIDTH = 10;

/** 1,234 → 1.2k。桁を読ませない（比べたいのは桁であって数字ではない） */
export function formatTokens(tokens: number): string {
	if (tokens < 1000) {
		return String(tokens);
	}
	if (tokens < 1000 * 1000) {
		return `${(tokens / 1000).toFixed(1)}k`;
	}
	return `${(tokens / 1000 / 1000).toFixed(2)}M`;
}

/** 金額。$0.0001 未満を 0 と出すと「無料で動いている」と誤解させるので下限を置く */
export function formatCost(usd: number): string {
	if (usd > 0 && usd < 0.0001) {
		return '<$0.0001';
	}
	return `$${usd.toFixed(4)}`;
}

/** 文字で描くゲージ。割合が取れないときは空の枠を返す（「0%」と出すと誤解する） */
export function bar(percent: number | null | undefined, width: number = BAR_WIDTH): string {
	if (percent === null || percent === undefined || !Number.isFinite(percent)) {
		return '─'.repeat(width);
	}
	const clamped = Math.max(0, Math.min(100, percent));
	const filled = Math.round((clamped / 100) * width);
	return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

/** リセットまでの残り時間。過ぎていれば「まもなく」（負の時間は出さない） */
export function formatReset(resetsAt: string | null | undefined, now: number = Date.now()): string {
	if (!resetsAt) {
		return '';
	}
	const at = Date.parse(resetsAt);
	if (Number.isNaN(at)) {
		return '';
	}
	const minutes = Math.round((at - now) / 60000);
	if (minutes <= 0) {
		return 'まもなくリセット';
	}
	if (minutes < 60) {
		return `${minutes} 分後にリセット`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rest = minutes % 60;
		return rest === 0 ? `${hours} 時間後にリセット` : `${hours} 時間 ${rest} 分後にリセット`;
	}
	return `${Math.floor(hours / 24)} 日後にリセット`;
}

function toGauge(label: string, window: UsageWindow | null | undefined, now: number): Gauge | undefined {
	if (!window) {
		return undefined;
	}
	const percent = window.utilization ?? undefined;
	return {
		label,
		percent,
		bar: bar(percent),
		detail: [percent === undefined ? '取得できず' : `${Math.round(percent)}%`, formatReset(window.resets_at, now)]
			.filter(Boolean)
			.join(' · ')
	};
}

/**
 * 枠の一覧をゲージに変換する。
 *
 * **週の枠を 1 本にまとめない**（T-037）。対話で使った分とアプリ経由（ヘッドレス）で
 * 使った分は別の枠から引かれるので、合算すると「まだ余裕がある」と誤読する。
 * ラベルの対応は SDK のフィールド名から取っている（`seven_day_oauth_apps` = アプリ経由）。
 */
export function toGauges(limits: RateLimitWindows | null | undefined, now: number = Date.now()): Gauge[] {
	if (!limits) {
		return [];
	}
	return [
		toGauge('5 時間', limits.five_hour, now),
		toGauge('週（対話）', limits.seven_day, now),
		toGauge('週（アプリ経由）', limits.seven_day_oauth_apps, now),
		toGauge('週（Opus）', limits.seven_day_opus, now),
		toGauge('週（Sonnet）', limits.seven_day_sonnet, now)
	].filter((gauge): gauge is Gauge => gauge !== undefined);
}

/** 文脈の使用量（T-020）。maxTokens が 0 のときは割合を出さない */
export function contextGauge(totalTokens: number, maxTokens: number): Gauge {
	const percent = maxTokens > 0 ? (totalTokens / maxTokens) * 100 : undefined;
	return {
		label: '文脈',
		percent,
		bar: bar(percent),
		detail: `${formatTokens(totalTokens)} / ${formatTokens(maxTokens)}${percent === undefined ? '' : ` · ${Math.round(percent)}%`}`
	};
}

export type CostAlert = 'none' | 'warn' | 'over';

/**
 * 上限に対する段階の判定。
 * `limit` が 0 以下なら**上限なし**として扱う（既定を「止めない」にしておく）。
 * 費用（T-059）と文脈の予算（T-153）で同じ規則を使う。
 */
export function thresholdLevel(used: number, limit: number, warnAtPercent: number = 80): CostAlert {
	if (!(limit > 0)) {
		return 'none';
	}
	if (used >= limit) {
		return 'over';
	}
	return used >= limit * (warnAtPercent / 100) ? 'warn' : 'none';
}

/** コスト上限の判定（T-059） */
export function costAlertLevel(costUsd: number, limitUsd: number, warnAtPercent: number = 80): CostAlert {
	return thresholdLevel(costUsd, limitUsd, warnAtPercent);
}

/**
 * 文脈の予算（T-153）。「このセッションは何トークンまで」を決められるようにする。
 * 上限そのものではなく**そこへ近づいていること**を伝えるのが目的なので、
 * 判定は費用と同じ 3 段階にそろえる。
 */
export function budgetGauge(usedTokens: number, budgetTokens: number): Gauge | undefined {
	if (!(budgetTokens > 0)) {
		return undefined;
	}
	const percent = (usedTokens / budgetTokens) * 100;
	return {
		label: '予算',
		percent,
		bar: bar(percent),
		detail: `${formatTokens(usedTokens)} / ${formatTokens(budgetTokens)} · ${Math.round(percent)}%`
	};
}
