/**
 * flaky テストの検出（tasks.md T-133）。
 *
 * 落ちたり通ったりするテストは、**放っておくと全部のテストが信用されなくなる**。
 * 「また例のやつでしょ」で赤を見過ごすようになった時点で、テストの意味が消える。
 *
 * 見分けかたは単純で、**同じコードのまま何度か回して、結果が揃わないもの**を探す。
 * ここは「何度か回した結果」を突き合わせるところだけを持つ（走らせるのは呼び出し側）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 1 回の実行で分かった、1 件のテストの結果 */
export interface TestOutcome {
	name: string;
	passed: boolean;
}

export type Stability = 'stable-pass' | 'stable-fail' | 'flaky';

export interface TestVerdict {
	name: string;
	stability: Stability;
	/** 通った回数 */
	passes: number;
	/** 落ちた回数 */
	failures: number;
	/** 実行に現れた回数。回によって出たり出なかったりするものを見つけるのに使う */
	runs: number;
}

/**
 * TAP（`node --test` の出力）から、1 回ぶんの結果を読む。
 *
 * `ok 1 - 名前` / `not ok 2 - 名前` の行だけを見る。
 * サブテストの見出し（`# Subtest:`）は結果ではないので拾わない。
 */
export function parseTap(output: string): TestOutcome[] {
	const outcomes: TestOutcome[] = [];
	for (const line of output.split('\n')) {
		const match = /^(not ok|ok)\s+\d+\s*-\s*(.+?)\s*$/.exec(line);
		if (!match) {
			continue;
		}
		const name = match[2].replace(/\s+# (SKIP|TODO).*$/i, '').trim();
		if (!name) {
			continue;
		}
		outcomes.push({ name, passed: match[1] === 'ok' });
	}
	return outcomes;
}

/**
 * 複数回ぶんの結果を突き合わせる。
 *
 * **同じ名前のテストが 1 回でも結果を変えたら flaky。**
 * 「n 回中 1 回だけ落ちた」も flaky で、たまたま今回通ったことに意味は無い。
 */
export function assessStability(runs: readonly (readonly TestOutcome[])[]): TestVerdict[] {
	const byName = new Map<string, { passes: number; failures: number }>();
	for (const run of runs) {
		for (const outcome of run) {
			const entry = byName.get(outcome.name) ?? { passes: 0, failures: 0 };
			if (outcome.passed) {
				entry.passes++;
			} else {
				entry.failures++;
			}
			byName.set(outcome.name, entry);
		}
	}
	const verdicts: TestVerdict[] = [];
	for (const [name, { passes, failures }] of byName) {
		const stability: Stability =
			passes > 0 && failures > 0 ? 'flaky' : failures > 0 ? 'stable-fail' : 'stable-pass';
		verdicts.push({ name, stability, passes, failures, runs: passes + failures });
	}
	// flaky を先に、その中では落ちた回数が多い順（＝当たりやすいもの）
	const order: Record<Stability, number> = { flaky: 0, 'stable-fail': 1, 'stable-pass': 2 };
	return verdicts.sort(
		(a, b) => order[a.stability] - order[b.stability] || b.failures - a.failures || a.name.localeCompare(b.name)
	);
}

/**
 * 実行のたびに現れたり消えたりするテスト。
 * 名前が動的に作られている（時刻やランダムを含む）ことが多く、
 * **それ自体が直すべき兆候**なので、flaky とは別に伝える。
 */
export function inconsistentlyPresent(verdicts: readonly TestVerdict[], totalRuns: number): TestVerdict[] {
	return verdicts.filter((verdict) => verdict.runs > 0 && verdict.runs < totalRuns);
}

export function formatReport(verdicts: readonly TestVerdict[], totalRuns: number): string {
	const flaky = verdicts.filter((v) => v.stability === 'flaky');
	const failing = verdicts.filter((v) => v.stability === 'stable-fail');
	const missing = inconsistentlyPresent(verdicts, totalRuns);

	const lines = [
		'# 不安定なテスト',
		'',
		`${totalRuns} 回まわして ${verdicts.length} 件を突き合わせました。`,
		''
	];

	if (flaky.length === 0 && failing.length === 0 && missing.length === 0) {
		lines.push(
			'**揺れているテストはありませんでした。**',
			'',
			`> ただし ${totalRuns} 回で出なかっただけ、ということはあります。`,
			'> 疑っているテストがあるなら、回数を増やしてもう一度試してください。',
			''
		);
		return lines.join('\n');
	}

	if (flaky.length > 0) {
		lines.push(
			'## 揺れているもの',
			'',
			'**同じコードのまま結果が変わりました。** 放っておくと、赤を見ても',
			'「また例のやつでしょ」と読み飛ばすようになり、テスト全体が信用されなくなります。',
			''
		);
		for (const verdict of flaky) {
			lines.push(`- \`${verdict.name}\` — ${verdict.runs} 回中 ${verdict.failures} 回失敗`);
		}
		lines.push('');
	}
	if (failing.length > 0) {
		lines.push('## 毎回落ちているもの', '', '揺れではなく、単に落ちています。', '');
		for (const verdict of failing) {
			lines.push(`- \`${verdict.name}\``);
		}
		lines.push('');
	}
	if (missing.length > 0) {
		lines.push(
			'## 回によって現れないもの',
			'',
			'実行のたびに出たり出なかったりしています。テスト名が動的に作られている',
			'（時刻や乱数を含む）ことが多く、**それ自体が直すべき兆候**です。',
			''
		);
		for (const verdict of missing) {
			lines.push(`- \`${verdict.name}\` — ${totalRuns} 回中 ${verdict.runs} 回だけ出現`);
		}
		lines.push('');
	}
	return lines.join('\n');
}
