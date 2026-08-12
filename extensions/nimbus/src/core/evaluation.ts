/**
 * 自作スキルの回帰テスト・ブレ幅・モデル比較（tasks.md T-165 / T-166 / T-167）。
 *
 * スキルやプロンプトを直したあと、**前に通っていたケースがまだ通るか**を確かめる手段が無い。
 * さらに、同じ指示を 2 回投げると違う答えが返るのがふつうなので、
 * 「1 回試して動いた」は根拠として弱い。
 *
 * ここは**判定と集計だけ**を持つ。走らせるのは呼び出し側（セッションが要るので）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface EvalCase {
	name: string;
	/** 投げる指示 */
	prompt: string;
	/** 応答に含まれていてほしい語（すべて含めば合格） */
	expect: string[];
	/** 含まれていたら不合格にする語 */
	reject?: string[];
}

export interface RunResult {
	/** 何回目か（ブレ幅を見るために複数回まわす） */
	attempt: number;
	text: string;
	durationMs: number;
	costUsd?: number;
	model?: string;
}

export type Verdict = 'passed' | 'failed';

export interface JudgedRun extends RunResult {
	verdict: Verdict;
	/** 落ちた理由（足りない語・入っていた語） */
	reason?: string;
}

/**
 * 1 回の結果を判定する。
 * **含まれていてほしい語がすべて揃ったときだけ合格**。部分点は付けない
 * （部分点を付けると「だいたい通った」が積み上がって、回帰に気づけなくなる）。
 */
export function judge(testCase: EvalCase, run: RunResult): JudgedRun {
	const haystack = run.text.toLowerCase();
	const missing = testCase.expect.filter((word) => !haystack.includes(word.toLowerCase()));
	if (missing.length > 0) {
		return { ...run, verdict: 'failed', reason: `含まれていない: ${missing.join(' / ')}` };
	}
	const forbidden = (testCase.reject ?? []).filter((word) => haystack.includes(word.toLowerCase()));
	if (forbidden.length > 0) {
		return { ...run, verdict: 'failed', reason: `入ってはいけない語: ${forbidden.join(' / ')}` };
	}
	return { ...run, verdict: 'passed' };
}

export interface Stability {
	attempts: number;
	passed: number;
	/** 0〜100。全部通れば 100、全部落ちれば 0 */
	passRate: number;
	/** 応答の長さのばらつき（変動係数 %）。大きいほど答えが安定していない */
	lengthVariation: number;
}

/**
 * ブレ幅（T-166）。
 *
 * **合格率だけでは足りない。** 毎回通っていても、答えの長さが倍半分に振れているなら
 * 「同じことをしている」とは言えない。長さのばらつきも併せて出す。
 */
export function measureStability(runs: readonly JudgedRun[]): Stability {
	const attempts = runs.length;
	const passed = runs.filter((run) => run.verdict === 'passed').length;
	const lengths = runs.map((run) => run.text.length);
	const mean = lengths.reduce((sum, value) => sum + value, 0) / (attempts || 1);
	const variance = lengths.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (attempts || 1);
	return {
		attempts,
		passed,
		passRate: attempts === 0 ? 0 : Math.round((passed / attempts) * 100),
		// 平均が 0（空の応答ばかり）のときに 0 除算しない
		lengthVariation: mean === 0 ? 0 : Math.round((Math.sqrt(variance) / mean) * 100)
	};
}

/** ブレ幅を言葉にする。**「安定している」と言い切れるのは、通っていて振れも小さいときだけ** */
export function describeStability(stability: Stability): string {
	if (stability.attempts === 0) {
		return 'まだ走らせていません';
	}
	const rate = `${stability.passed}/${stability.attempts} 合格`;
	if (stability.passed !== stability.attempts) {
		return `${rate} — **同じ指示で結果が変わっています**`;
	}
	if (stability.lengthVariation > 40) {
		return `${rate}（ただし応答の長さが ${stability.lengthVariation}% 振れています）`;
	}
	return `${rate} · 振れ ${stability.lengthVariation}%`;
}

export interface ModelComparison {
	model: string;
	stability: Stability;
	medianDurationMs: number;
	totalCostUsd: number;
}

function median(values: readonly number[]): number {
	if (values.length === 0) {
		return 0;
	}
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** モデルごとにまとめる（T-167）。**合格率が同じなら安いほうが上** */
export function compareModels(runs: readonly JudgedRun[]): ModelComparison[] {
	const byModel = new Map<string, JudgedRun[]>();
	for (const run of runs) {
		const model = run.model ?? '（不明）';
		byModel.set(model, [...(byModel.get(model) ?? []), run]);
	}
	return [...byModel.entries()]
		.map(([model, modelRuns]) => ({
			model,
			stability: measureStability(modelRuns),
			medianDurationMs: median(modelRuns.map((run) => run.durationMs)),
			totalCostUsd: modelRuns.reduce((sum, run) => sum + (run.costUsd ?? 0), 0)
		}))
		.sort((a, b) => b.stability.passRate - a.stability.passRate || a.totalCostUsd - b.totalCostUsd);
}

/**
 * 「軽いモデルで足りる」と言えるか（T-167 の狙い）。
 * **通っていることが先。** 安くても落ちるなら勧めない。
 */
export function cheapestPassing(comparisons: readonly ModelComparison[]): ModelComparison | undefined {
	return [...comparisons]
		.filter((comparison) => comparison.stability.passRate === 100)
		.sort((a, b) => a.totalCostUsd - b.totalCostUsd)[0];
}
