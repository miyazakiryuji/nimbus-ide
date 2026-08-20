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

/** 入力欄の下に出す枠（5 時間と週）だけを、残りとリセットに直す（T-282） */
function quotaWindows(
	limits: RateLimitWindows | null | undefined,
	now: number
): { label: string; left: number; reset: string }[] {
	const rows: { label: string; left: number; reset: string }[] = [];
	for (const [label, window] of [
		['5 時間', limits?.five_hour],
		['週', limits?.seven_day]
	] as const) {
		if (!window || window.utilization === null || window.utilization === undefined) {
			continue;
		}
		rows.push({
			label,
			left: Math.max(0, Math.round(100 - window.utilization)),
			reset: formatReset(window.resets_at, now)
		});
	}
	return rows;
}

/**
 * 入力欄の下に出す 1 行（T-282）。
 *
 * **1 行に収める。** ここは視線がいちばん通る場所なので、何行も置くと会話が押し出される。
 * 出すのは「あとどれだけ使えるか」だけ。**いつ戻るかは入れない** —
 * サイドバーの既定幅では、リセットまで入れると**週の残りが末尾から切れる**（実測）。
 * 週の枠が尽きて週末が潰れるのを避けるのがこの行の眼目なので、切れてよいのはそちらではない。
 * リセットは `quotaTooltip`（指を置いたとき）へ、内訳と費用は使用量ビューへ。
 *
 * 枠の無い環境（API キー / Bedrock / Vertex）では `rate_limits` が null で返る。
 * そのときは **undefined を返して行ごと消す** — 空欄を置くと「取れていない」のか
 * 「枠が無い」のか分からない。
 */
export function quotaLine(limits: RateLimitWindows | null | undefined, now: number = Date.now()): string | undefined {
	const parts = quotaWindows(limits, now).map((row) => `${row.label} 残り ${row.left}%`);
	return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** 残りの少なさ。**色だけに頼らない**ので、記号と数字も同じことを言う（T-295） */
export type QuotaTone = 'ok' | 'warn' | 'low';

export interface QuotaGauge {
	/** `5 時間` / `週` */
	label: string;
	/** 残り（%） */
	left: number;
	/** いつ戻るか（空のこともある） */
	reset: string;
	tone: QuotaTone;
}

function toneOf(left: number): QuotaTone {
	if (left <= 10) {
		return 'low';
	}
	return left <= 30 ? 'warn' : 'ok';
}

/**
 * 枠の行に出す目盛り（T-295）。
 *
 * 数字だけだと「94%」が多いのか少ないのか、読んで考えないと分からない。
 * **バー・数字・印の 3 つが同じことを言う形**にする — 色覚の違いでも、
 * モノクロのスクリーンショットでも、どれか 1 つは必ず読める。
 * 印は**テーマトークンで塗った SVG**（T-302）。絵文字はテーマの色に従わないので使わない。
 */
export function quotaGauges(limits: RateLimitWindows | null | undefined, now: number = Date.now()): QuotaGauge[] {
	return quotaWindows(limits, now).map((row) => ({
		label: row.label,
		left: row.left,
		reset: row.reset,
		tone: toneOf(row.left)
	}));
}

/**
 * 枠の行に指を置いたときに出す中身（T-282）。
 * 1 行に入りきらない「いつ戻るか」はここで出す。
 */
export function quotaTooltip(limits: RateLimitWindows | null | undefined, now: number = Date.now()): string | undefined {
	const parts = quotaWindows(limits, now).map(
		(row) => `${row.label}の枠 残り ${row.left}%${row.reset ? `（${row.reset}）` : ''}`
	);
	return parts.length > 0 ? parts.join('\n') : undefined;
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
