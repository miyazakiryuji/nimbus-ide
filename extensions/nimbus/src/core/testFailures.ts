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
	limit: number
): { failures: TestFailure[]; total: number } {
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

	return { failures: all.slice(0, Math.max(1, limit)), total: all.length };
}

/** 通知に出す一行 */
export function testFailureHeadline(total: number): string {
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
	const parts = [`テストが ${total} 件失敗しました。`, ''];
	failures.forEach((failure, index) => {
		parts.push(`${index + 1}. ${failure.name}`);
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
