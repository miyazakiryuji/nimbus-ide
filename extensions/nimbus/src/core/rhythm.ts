/**
 * 作業のリズム（tasks.md T-089 区切りの提案 / T-053 待ち時間の使い方）。
 *
 * エージェントを回していると、**待っている時間**と**ぶっ通しの時間**が両方増える。
 * どちらも自分では気づけない（画面を見ていると時間の感覚が消える）。
 *
 * 提案は**押しつけない**。1 回言って、しばらく黙る。同じことを繰り返す通知は、
 * それ自体が無視される訓練になる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface RhythmInput {
	/** このセッションを始めた時刻 */
	startedAt: number;
	now: number;
	/** 前回すすめた時刻（まだなら undefined） */
	lastSuggestedAt?: number;
	/** いま走っているタスクの数 */
	running: number;
	/** 承認待ちの数 */
	pending: number;
}

export interface Suggestion {
	kind: 'break' | 'fill-wait' | 'none';
	message: string;
}

const MINUTE = 60 * 1000;

/** これ以上続けたら、一度すすめる */
const LONG_SESSION = 90 * MINUTE;

/** 一度すすめたら、これだけ黙る */
const QUIET = 45 * MINUTE;

/** 経過を人が読む形に */
export function formatDuration(ms: number): string {
	const minutes = Math.floor(ms / MINUTE);
	if (minutes < 60) {
		return `${minutes} 分`;
	}
	const hours = Math.floor(minutes / 60);
	return `${hours} 時間 ${minutes % 60} 分`;
}

/**
 * いま何をすすめるか。
 *
 * 優先するのは休憩。**待ち時間の提案は、待っているときにしか意味が無い**ので、
 * 走っているものが無ければ出さない。
 */
export function suggest({ startedAt, now, lastSuggestedAt, running, pending }: RhythmInput): Suggestion {
	const quiet = lastSuggestedAt !== undefined && now - lastSuggestedAt < QUIET;
	const elapsed = now - startedAt;

	if (!quiet && elapsed >= LONG_SESSION) {
		return {
			kind: 'break',
			message: `${formatDuration(elapsed)} 続けています。一度離れると、戻ったときの判断が変わります。`
		};
	}

	// 承認待ちがあるなら「待ち時間」ではない。人の番なので、そちらを先に
	if (!quiet && running > 0 && pending === 0) {
		return {
			kind: 'fill-wait',
			message: `${running} 件が走っています。終わるまでの間に、別の作業へ移れます（結果は通知で届きます）。`
		};
	}

	return { kind: 'none', message: '' };
}

/** いまのようすを 1 枚にする */
export function renderRhythm(input: RhythmInput): string {
	const suggestion = suggest(input);
	const lines = [
		'# いまのようす',
		'',
		`- 続けている時間: **${formatDuration(input.now - input.startedAt)}**`,
		`- 走っているタスク: **${input.running}** / 承認待ち: **${input.pending}**`,
		''
	];

	if (suggestion.kind === 'break') {
		lines.push('## 一度区切りませんか', '', suggestion.message, '');
	} else if (suggestion.kind === 'fill-wait') {
		lines.push('## 待っている間に', '', suggestion.message, '');
	} else if (input.pending > 0) {
		lines.push(`承認待ちが ${input.pending} 件あります。**ここは人の番**なので、先に片付けてください。`, '');
	} else {
		lines.push('いまのところ、特にありません。', '');
	}

	return lines.join('\n');
}
