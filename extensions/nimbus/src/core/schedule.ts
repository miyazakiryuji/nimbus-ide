/**
 * 寝る前に仕込む（tasks.md T-051 予約実行）。
 *
 * 「朝までにこれ調べておいて」は、任せかたとしていちばん筋がいい。待っていないので
 * 遅くても困らないし、失敗していても朝に分かるだけ。**ただし、寝ている間に承認を求められると
 * 何も進まない**ので、そこをどう扱うかが設計の芯になる。
 *
 * 時刻の計算と、仕込めるかどうかの判断だけをここに置く。実行は呼び出し側。
 * VS Code に依存しないので単体で検証できる。
 */

export interface ScheduledRun {
	id: string;
	/** 実行する時刻（epoch ミリ秒） */
	at: number;
	prompt: string;
	/** 承認が要るツールを自動で許可してよいか（既定は false） */
	autoApprove: boolean;
	state: 'waiting' | 'done' | 'cancelled';
}

/** `07:30` のような指定を、次に来るその時刻に変える */
export function nextTimeAt(text: string, now: number): number | undefined {
	const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const hours = Number(match[1]);
	const minutes = Number(match[2]);
	if (hours > 23 || minutes > 59) {
		return undefined;
	}
	const date = new Date(now);
	date.setSeconds(0, 0);
	date.setHours(hours, minutes);
	// 過ぎていたら翌日。「7:30 に」と言われて過去に実行することはない
	return date.getTime() <= now ? date.getTime() + 24 * 60 * 60 * 1000 : date.getTime();
}

/** `30分後` `2時間後` のような指定 */
export function afterDuration(text: string, now: number): number | undefined {
	const match = /^(\d+)\s*(分|時間)後$/.exec(text.trim());
	if (!match) {
		return undefined;
	}
	const amount = Number(match[1]);
	return now + amount * (match[2] === '分' ? 60_000 : 3_600_000);
}

export function parseWhen(text: string, now: number): number | undefined {
	return nextTimeAt(text, now) ?? afterDuration(text, now);
}

/** 実行の時刻が来ているもの */
export function dueRuns(runs: readonly ScheduledRun[], now: number): ScheduledRun[] {
	return runs.filter((run) => run.state === 'waiting' && run.at <= now);
}

/**
 * 仕込む前の注意。
 *
 * **承認を自動で通さない限り、寝ている間は止まったままになる**。それを黙って仕込むと
 * 「朝になっても何も進んでいない」になるので、必ず伝える。
 */
export function warningFor(run: Pick<ScheduledRun, 'autoApprove'>): string | undefined {
	return run.autoApprove
		? '承認を自動で通します。**取り返しのつかない操作もそのまま実行される**ので、調べもの以外には使わないでください。'
		: '承認が必要な操作で止まります。調べもの（読むだけ）なら、そのまま進みます。';
}

export function formatWhen(at: number, now: number): string {
	const minutes = Math.round((at - now) / 60000);
	if (minutes < 60) {
		return `${minutes} 分後`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours} 時間 ${minutes % 60} 分後`;
}

export function renderSchedule(runs: readonly ScheduledRun[], now: number): string {
	const waiting = runs.filter((run) => run.state === 'waiting');
	if (waiting.length === 0) {
		return '# 仕込んであるもの\n\nありません。\n';
	}
	const lines = ['# 仕込んであるもの', ''];
	for (const run of waiting.sort((a, b) => a.at - b.at)) {
		lines.push(`- **${formatWhen(run.at, now)}** — ${run.prompt}${run.autoApprove ? '（承認を自動で通します）' : ''}`);
	}
	lines.push('', '結果は朝に「ふりかえり（昨夜から）」で見られます。');
	return lines.join('\n');
}
