/**
 * 証跡つき完了報告（tasks.md T-081）。
 *
 * 「できました」は、それ自体では何の情報も持たない。**テストを実行したのか**、
 * **通ったのか**を、会話のイベント列から機械的に取り出して報告に添える。
 * 「動いた気がする」を排除するのが目的なので、**分からないときは「分からない」と言う** —
 * 出力の形はツールごとに違い、無理に判定すると「通った」と嘘をつくことになる。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { buildAttributions, type Attribution } from './activity';

/** テストを走らせるコマンドか。主要な言語・ランナーを広めに拾う */
const TEST_COMMAND =
	/(^|[\s;&|])(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|node\s+--test\b|(?:pytest|jest|vitest|mocha|ava|rspec|phpunit|ctest)\b|go\s+test\b|cargo\s+test\b|(?:flutter|dart)\s+test\b|(?:\.\/)?gradlew?\s+\S*test\b|mvn\s+\S*test\b|swift\s+test\b|dotnet\s+test\b|(?:bash|sh|zsh)\s+\S*test[\w.-]*\.sh\b)/i;

export function isTestCommand(command: string): boolean {
	return TEST_COMMAND.test(command);
}

export type TestOutcome = 'passed' | 'failed' | 'unknown';

/** 「失敗 0 件」を表す言い回し。ランナーごとに違うので複数持つ */
const PASSED = [/\bfail(?:ed|ures|ing)?\s*[:=]?\s*0\b/i, /\b0\s+fail/i, /\ball tests passed\b/i, /\bPASS\b/, /\bBUILD SUCCESS/i];
/** 「失敗あり」を表す言い回し。0 件と食い違わないよう 1 以上を求める */
const FAILED = [/\bfail(?:ed|ures|ing)?\s*[:=]?\s*[1-9]/i, /\bFAILED\b/, /\bFAILURE\b/i, /✖/, /\bAssertionError\b/];

/**
 * 実行結果から成否を決める。
 * **失敗を先に見る** — 「1 件失敗」の出力には成功した件数も並んでいることが多く、
 * 成功の言い回しを先に当てると失敗を見落とす。
 */
export function assessTestOutcome(isError: boolean, output: string): TestOutcome {
	if (isError) {
		return 'failed';
	}
	if (FAILED.some((pattern) => pattern.test(output))) {
		return 'failed';
	}
	if (PASSED.some((pattern) => pattern.test(output))) {
		return 'passed';
	}
	// 判定できないものを「通った」に倒さない。それをやると報告が嘘になる
	return 'unknown';
}

export interface TestRun {
	command: string;
	at: number;
	outcome: TestOutcome;
	/** 判断のもとにした出力の断片（報告にそのまま貼る） */
	output: string;
}

export interface Evidence {
	runs: TestRun[];
	/** 指示ごとの修正（何を変えたのかを報告に載せる） */
	attributions: Attribution[];
	/** 変更のあったファイル（重複なし） */
	changedFiles: string[];
}

/** イベント列から証跡を集める */
export function collectEvidence(events: readonly NimbusEvent[]): Evidence {
	// ツール呼び出しと結果は toolUseId で対応づける
	const pending = new Map<string, { command: string; at: number }>();
	const runs: TestRun[] = [];
	for (const event of events) {
		if (event.kind === 'tool-use' && event.toolName === 'Bash') {
			const input = event.input as { command?: unknown } | null;
			const command = typeof input?.command === 'string' ? input.command : '';
			if (command && isTestCommand(command)) {
				pending.set(event.toolUseId, { command: command.replace(/\s+/g, ' ').trim(), at: event.timestamp });
			}
			continue;
		}
		if (event.kind === 'tool-result') {
			const started = pending.get(event.toolUseId);
			if (started) {
				pending.delete(event.toolUseId);
				runs.push({
					command: started.command,
					at: started.at,
					outcome: assessTestOutcome(event.isError, event.preview),
					output: event.preview
				});
			}
		}
	}
	// 結果がまだ返っていない実行も、走らせたこと自体は事実なので残す
	for (const [, started] of pending) {
		runs.push({ command: started.command, at: started.at, outcome: 'unknown', output: '（実行中）' });
	}
	runs.sort((a, b) => a.at - b.at);

	const attributions = buildAttributions(events);
	const changedFiles = [...new Set(attributions.flatMap((a) => a.edits.map((e) => e.path)))];
	return { runs, attributions, changedFiles };
}

/**
 * 「完了」と言ってよい状態か。
 * **テストを走らせていない**、または**最後の実行が通っていない**なら、言ってはいけない。
 */
export function isBackedByTests(evidence: Evidence): boolean {
	const last = evidence.runs[evidence.runs.length - 1];
	return last !== undefined && last.outcome === 'passed';
}

/** 証跡の一行まとめ。完了を宣言する前に、これを読ませる */
export function describeEvidence(evidence: Evidence): string {
	if (evidence.runs.length === 0) {
		return 'テストを実行していません';
	}
	const last = evidence.runs[evidence.runs.length - 1];
	const outcome = last.outcome === 'passed' ? '成功' : last.outcome === 'failed' ? '失敗' : '成否を判定できず';
	return `テスト ${evidence.runs.length} 回実行・最後は${outcome}（${last.command}）`;
}
