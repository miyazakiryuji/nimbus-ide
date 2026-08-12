/**
 * どのコミットで壊れたかを絞り込む（tasks.md T-183 二分探索デバッグ）。
 *
 * `git bisect` は強力だが、始めるまでの手間（good / bad をどう決めるか、何回かかるか）で
 * 使われないまま終わる。**残り回数と次に見る場所を先に出す**ことで、始めやすくする。
 *
 * git を実際に動かすのは呼び出し側。ここは「次にどこを見るか」を決める算数だけ。
 * VS Code に依存しないので単体で検証できる。
 */

export interface BisectState {
	/** 古い順に並んだ候補（`git log --reverse` の並び） */
	commits: string[];
	/** 壊れていないと分かっている位置（この位置までは良い） */
	goodIndex: number;
	/** 壊れていると分かっている位置 */
	badIndex: number;
}

/** 次に確かめる位置。範囲が詰まっていれば undefined（＝犯人が確定している） */
export function nextIndex({ goodIndex, badIndex }: BisectState): number | undefined {
	if (badIndex - goodIndex <= 1) {
		return undefined;
	}
	return goodIndex + Math.floor((badIndex - goodIndex) / 2);
}

/** 残り何回で決まるか（log2）。「あと 3 回」と分かると人は始められる */
export function remainingSteps({ goodIndex, badIndex }: BisectState): number {
	const span = Math.max(0, badIndex - goodIndex - 1);
	return span === 0 ? 0 : Math.ceil(Math.log2(span + 1));
}

/** 確定した犯人（範囲が詰まったときだけ） */
export function culprit(state: BisectState): string | undefined {
	return nextIndex(state) === undefined ? state.commits[state.badIndex] : undefined;
}

/** 結果を受けて範囲を狭める */
export function narrow(state: BisectState, index: number, verdict: 'good' | 'bad'): BisectState {
	return verdict === 'good'
		? { ...state, goodIndex: Math.max(state.goodIndex, index) }
		: { ...state, badIndex: Math.min(state.badIndex, index) };
}

export function renderBisect(state: BisectState): string {
	const found = culprit(state);
	if (found) {
		return [
			'# 壊れた場所が決まりました',
			'',
			`\`${found}\` で壊れています。`,
			'',
			'```bash',
			`git show ${found}`,
			'```',
			''
		].join('\n');
	}

	const next = nextIndex(state);
	const steps = remainingSteps(state);
	return [
		'# どこで壊れたかを絞り込む',
		'',
		`- 候補: **${Math.max(0, state.badIndex - state.goodIndex - 1)} コミット**`,
		`- 残り **${steps} 回**で決まります`,
		'',
		'## 次に確かめるところ',
		'',
		'```bash',
		`git checkout ${next !== undefined ? state.commits[next] : ''}`,
		'```',
		'',
		'ここで再現するかどうかを見て、また実行してください。',
		''
	].join('\n');
}
