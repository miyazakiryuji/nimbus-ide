/**
 * 落ちたテストを、そのままセッションへ渡せる形にする（tasks.md T-039）。
 *
 * Test Explorer は「どのテストが、どのファイルの何行目で、どんなメッセージで落ちたか」を
 * 構造として持っている。ターミナルの出力を読み解かせるより正確で、短い。
 * **フォークにした旨味が一番出る**のがここ（`tasks.md` 選ぶ基準 2）。
 *
 * VS Code に依存しない。木を歩いて失敗だけを取り出し、読める文にするところまでを置く。
 */

/** Failed / Errored（`TestResultState`。1=Queued 2=Running 3=Passed 4=Failed 5=Skipped 6=Errored） */
const FAILED_STATES = new Set([4, 6]);

export function isFailedState(state: number): boolean {
	return FAILED_STATES.has(state);
}

/** VS Code の `TestResultSnapshot` から必要なものだけを写した木 */
export interface TestResultNode {
	label: string;
	/** テストが書かれているファイル（絶対パス） */
	file?: string;
	/** 0 起点の行 */
	line?: number;
	failed: boolean;
	/** 通った（T-108 の比較に使う。「実行されなかった」と区別する） */
	passed?: boolean;
	messages: string[];
	children: readonly TestResultNode[];
}

export interface TestFailure {
	/** 親から辿った名前（`スイート › テスト`） */
	name: string;
	file?: string;
	/** 0 起点の行 */
	line?: number;
	messages: string[];
	/** 前回は通っていたのに落ちた（T-108）。直近の変更が壊した可能性が高い */
	regression?: boolean;
}

/**
 * 失敗するテストから始めさせる（T-107）。
 *
 * 「実装してからテストを書く」と、テストは**実装に合わせて**書かれてしまう。
 * それでは「動いた気がする」を潰せない。先に赤を見てから緑にする、を頼み方で固定する。
 */
export function buildFailingTestPrompt(goal: string, context?: string): string {
	const parts = [
		`次のものを作ります: ${goal.trim()}`,
		'',
		'**先に落ちるテストを書いてください。** 手順:',
		'1. 期待する振る舞いをテストに書く（実装はまだ書かない）',
		'2. テストを走らせて、**落ちること**を確かめる。落ちなければ、テストが振る舞いを捉えていません',
		'3. そのテストが通る、いちばん小さい実装を書く',
		'4. もう一度走らせて緑になったことを確かめる',
		'',
		'**テストを実装に合わせて書き換えないでください。** 緑にならないときは実装の方を直します。',
		'既存のテストの書き方に合わせてください。'
	];
	if (context) {
		parts.push('', '対象:', '````', context, '````');
	}
	return parts.join('\n');
}

/** 1 件あたりのメッセージの上限。スタックトレースは長くなりがち */
const MAX_MESSAGE_CHARS = 1200;
const MAX_MESSAGES_PER_FAILURE = 3;

function hasFailureInside(node: TestResultNode): boolean {
	return node.failed || node.children.some(hasFailureInside);
}

/**
 * 失敗した**末端**だけを集める。
 * スイートも「失敗」として立つので、そのまま拾うと「A スイート」「A › B テスト」が二重に並ぶ。
 * 中に失敗を含む節は飛ばし、いちばん深いところだけを報告する。
 */
export function collectFailures(
	nodes: readonly TestResultNode[],
	limit: number,
	previouslyPassed?: ReadonlySet<string>
): { failures: TestFailure[]; total: number; regressions: number } {
	const all: TestFailure[] = [];

	const walk = (children: readonly TestResultNode[], prefix: string): void => {
		for (const node of children) {
			const name = prefix ? `${prefix} › ${node.label}` : node.label;
			if (node.failed && !node.children.some(hasFailureInside)) {
				all.push({
					name,
					file: node.file,
					line: node.line,
					messages: node.messages
						.map((message) => message.trim())
						.filter((message) => message.length > 0)
						.slice(0, MAX_MESSAGES_PER_FAILURE)
						.map((message) =>
							message.length > MAX_MESSAGE_CHARS ? `${message.slice(0, MAX_MESSAGE_CHARS)}\n…（省略）` : message
						)
				});
			}
			walk(node.children, name);
		}
	};
	walk(nodes, '');

	// 回帰（前回まで通っていたもの）は上限で切られてはいけないので、先に並べる（T-108）
	const marked = previouslyPassed ? markRegressions(all, previouslyPassed) : all;
	const sorted = [...marked].sort((a, b) => Number(b.regression ?? false) - Number(a.regression ?? false));
	return {
		failures: sorted.slice(0, Math.max(1, limit)),
		total: sorted.length,
		regressions: sorted.filter((failure) => failure.regression).length
	};
}

/**
 * 通った末端テストの名前（T-108 の基準になる）。
 * スイートは数えない — 中の 1 つが落ちればスイートも落ちるので、比較の単位にならない。
 */
export function collectPassed(nodes: readonly TestResultNode[]): Set<string> {
	const passed = new Set<string>();
	const walk = (children: readonly TestResultNode[], prefix: string): void => {
		for (const node of children) {
			const name = prefix ? `${prefix} › ${node.label}` : node.label;
			if (node.passed && node.children.length === 0) {
				passed.add(name);
			}
			walk(node.children, name);
		}
	};
	walk(nodes, '');
	return passed;
}

/**
 * 前回通っていたのに落ちたものに印を付ける（T-108 回帰の検知）。
 * 「もともと落ちている」と「いま壊した」はまったく別の話なので、混ぜない。
 */
export function markRegressions(
	failures: readonly TestFailure[],
	previouslyPassed: ReadonlySet<string>
): TestFailure[] {
	return failures.map((failure) =>
		previouslyPassed.has(failure.name) ? { ...failure, regression: true } : failure
	);
}

/** 通知に出す一行。回帰があるならそれを先に言う */
export function testFailureHeadline(total: number, regressions = 0): string {
	if (regressions > 0) {
		return `前回通っていたテストが ${regressions} 件落ちました（失敗は全部で ${total} 件）`;
	}
	return `テストが ${total} 件失敗しました`;
}

/**
 * セッションへ投入する文。
 * メッセージは 4 連バッククォートで囲む（中に ``` が現れても壊れないように）。
 */
export function buildTestFailurePrompt(failures: readonly TestFailure[], total: number): string {
	if (failures.length === 0) {
		return '';
	}
	const regressions = failures.filter((failure) => failure.regression).length;
	const parts = [
		regressions > 0
			? `テストが ${total} 件失敗しました。うち ${regressions} 件は**前回まで通っていた**もので、直近の変更が壊した可能性が高いです。`
			: `テストが ${total} 件失敗しました。`,
		''
	];
	failures.forEach((failure, index) => {
		parts.push(`${index + 1}. ${failure.name}${failure.regression ? '（前回は通っていました）' : ''}`);
		if (failure.file) {
			// 行は 1 起点に戻す（エディタの表示と Read ツールの出力に合わせる）
			parts.push(`   ${failure.file}${failure.line === undefined ? '' : `:${failure.line + 1}`}`);
		}
		if (failure.messages.length > 0) {
			parts.push('````', failure.messages.join('\n\n'), '````');
		}
		parts.push('');
	});
	if (total > failures.length) {
		parts.push(`…他 ${total - failures.length} 件は省略しました。`, '');
	}
	parts.push('原因を調べて直してください。まず何が起きているかを説明してから、修正に入ってください。');
	return parts.join('\n');
}
