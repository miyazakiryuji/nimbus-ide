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
	/** 失敗（error）で止まっているセッションの数（T-336・無指定は 0） */
	failed?: number;
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

/**
 * 待ち時間コンパス（T-336）。「いま何を見るべきか」を 1 つの短い状態にする。
 *
 * suggest() と違い**押しつけの心配が無い**（開いたときにしか見えない）ので、
 * 黙る時間（QUIET）は挟まず、聞かれたらいつでも今の判定を返す。
 * 順番が判定そのもの: 人の番（承認）→ デバッグ → 区切る → 別作業 → 人の番（指示）。
 */
export interface CompassState {
	kind: 'your-turn' | 'see-debug' | 'take-break' | 'switch-work';
	/** 短い状態（見出しに出す） */
	label: string;
	/** 一言の根拠 */
	reason: string;
}

export function compass({ startedAt, now, running, pending, failed = 0 }: RhythmInput): CompassState {
	if (pending > 0) {
		return {
			kind: 'your-turn',
			label: '人の番',
			reason: `承認待ちが ${pending} 件。エージェントはそこで止まっています。`
		};
	}
	if (failed > 0) {
		return {
			kind: 'see-debug',
			label: 'デバッグを見る',
			reason: `失敗が ${failed} 件。走らせ直す前に、何で落ちたのかを先に。`
		};
	}
	if (now - startedAt >= LONG_SESSION) {
		return {
			kind: 'take-break',
			label: '区切る',
			reason: `${formatDuration(now - startedAt)} 続けています。一度離れると、戻ったときの判断が変わります。`
		};
	}
	if (running > 0) {
		return {
			kind: 'switch-work',
			label: '別作業へ',
			reason: `${running} 件が走っています。待つより移るほうが速い（結果は状態の帯に出ます）。`
		};
	}
	return {
		kind: 'your-turn',
		label: '人の番',
		reason: '走っているものがありません。次の指示を出すところから。'
	};
}

/** いまのようすを 1 枚にする */
export function renderRhythm(input: RhythmInput): string {
	const suggestion = suggest(input);
	const state = compass(input);
	const lines = [
		'# いまのようす',
		'',
		`**コンパス: ${state.label}** — ${state.reason}`,
		'',
		`- 続けている時間: **${formatDuration(input.now - input.startedAt)}**`,
		`- 走っているタスク: **${input.running}** / 承認待ち: **${input.pending}** / 失敗: **${input.failed ?? 0}**`,
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
