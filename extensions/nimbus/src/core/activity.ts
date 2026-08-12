/**
 * セッションの中で起きたことを、イベント列から組み立て直す
 * （tasks.md T-018 / T-022 / T-023 / T-027）。
 *
 * イベントは時系列に流れてくるだけで、「いまサブエージェントが何本走っているか」
 * 「どのフックが落ちたか」「どのファイルを読んだか」は、そのままでは読み取れない。
 * ここで**畳んで**一覧にする。表示側は畳んだ結果を並べるだけにする。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { CompactionEvent, NimbusEvent } from '../events';

export interface SubagentRun {
	taskId: string;
	description: string;
	subagentType?: string;
	status: 'pending' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';
	prompt?: string;
	lastToolName?: string;
	summary?: string;
	error?: string;
	totalTokens?: number;
	toolUses?: number;
	durationMs?: number;
	startedAt: number;
	updatedAt: number;
}

export interface HookRun {
	hookId: string;
	hookName: string;
	hookEvent: string;
	outcome?: 'success' | 'error' | 'cancelled';
	exitCode?: number;
	output?: string;
	stderr?: string;
	startedAt: number;
	finishedAt?: number;
}

export interface TouchedFile {
	path: string;
	reads: number;
	writes: number;
	lastAt: number;
}

export interface Activity {
	/** 開始が新しい順 */
	subagents: SubagentRun[];
	/** 発火が新しい順 */
	hooks: HookRun[];
	/** 最後に触ったのが新しい順 */
	files: TouchedFile[];
	/** 発生が新しい順 */
	compactions: CompactionEvent[];
}

/** ファイルを読むツール（T-023 の「読み込まれたファイル一覧」の対象） */
const READ_TOOLS = new Set(['Read', 'NotebookRead']);
/** ファイルを書くツール。読んだものと分けて数える */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function filePathOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	const path = record['file_path'] ?? record['notebook_path'] ?? record['path'];
	return typeof path === 'string' && path ? path : undefined;
}

/**
 * イベント列を畳んで一覧にする。
 * 同じ ID のものは**後から来たイベントで上書き**する（進捗は最新だけ見せたい）。
 */
export function buildActivity(events: readonly NimbusEvent[]): Activity {
	const subagents = new Map<string, SubagentRun>();
	const hooks = new Map<string, HookRun>();
	const files = new Map<string, TouchedFile>();
	const compactions: CompactionEvent[] = [];

	for (const event of events) {
		switch (event.kind) {
			case 'subagent': {
				const existing = subagents.get(event.taskId);
				const run: SubagentRun = existing ?? {
					taskId: event.taskId,
					description: event.description ?? '(名前なし)',
					status: 'running',
					startedAt: event.timestamp,
					updatedAt: event.timestamp
				};
				run.updatedAt = event.timestamp;
				// 後から来た値だけを上書きする（undefined で既知の値を消さない）
				if (event.description) {
					run.description = event.description;
				}
				if (event.subagentType) {
					run.subagentType = event.subagentType;
				}
				if (event.prompt) {
					run.prompt = event.prompt;
				}
				if (event.status) {
					run.status = event.status;
				}
				if (event.error) {
					run.error = event.error;
				}
				if (event.lastToolName) {
					run.lastToolName = event.lastToolName;
				}
				if (event.summary) {
					run.summary = event.summary;
				}
				if (event.usage) {
					run.totalTokens = event.usage.totalTokens;
					run.toolUses = event.usage.toolUses;
					run.durationMs = event.usage.durationMs;
				}
				subagents.set(event.taskId, run);
				break;
			}

			case 'hook': {
				const existing = hooks.get(event.hookId);
				const run: HookRun = existing ?? {
					hookId: event.hookId,
					hookName: event.hookName,
					hookEvent: event.hookEvent,
					startedAt: event.timestamp
				};
				if (event.output) {
					run.output = event.output;
				}
				if (event.stderr) {
					run.stderr = event.stderr;
				}
				if (event.phase === 'response') {
					run.outcome = event.outcome;
					run.exitCode = event.exitCode;
					run.finishedAt = event.timestamp;
				}
				hooks.set(event.hookId, run);
				break;
			}

			case 'compaction':
				compactions.push(event);
				break;

			case 'tool-use': {
				const path = filePathOf(event.input);
				const isRead = READ_TOOLS.has(event.toolName);
				const isWrite = WRITE_TOOLS.has(event.toolName);
				if (!path || (!isRead && !isWrite)) {
					break;
				}
				const touched = files.get(path) ?? { path, reads: 0, writes: 0, lastAt: event.timestamp };
				if (isRead) {
					touched.reads++;
				} else {
					touched.writes++;
				}
				touched.lastAt = event.timestamp;
				files.set(path, touched);
				break;
			}

			default:
				break;
		}
	}

	return {
		subagents: [...subagents.values()].sort((a, b) => b.startedAt - a.startedAt),
		hooks: [...hooks.values()].sort((a, b) => b.startedAt - a.startedAt),
		files: [...files.values()].sort((a, b) => b.lastAt - a.lastAt),
		compactions: [...compactions].reverse()
	};
}

/**
 * 「この修正はどの指示から生まれたか」（tasks.md T-024）。
 *
 * 差分をファイル単位で見せても「なぜこうなったか」は分からない。
 * **きっかけになった指示**と結びつけると、レビューの単位が「ファイル」から「意図」になる。
 */
export interface Attribution {
	/** きっかけになった指示 */
	prompt: string;
	at: number;
	/** その指示から生まれた書き込み */
	edits: { path: string; toolName: string; at: number }[];
	/** その指示で読んだファイル（何を見て決めたかが分かる） */
	reads: string[];
}

/**
 * 指示ごとに、その後の書き込みをまとめる。**新しい指示が来るまで**が 1 つの区切り。
 * 書き込みが 1 つも無かった指示は返さない（見たいのは「修正の出どころ」なので）。
 */
export function buildAttributions(events: readonly NimbusEvent[]): Attribution[] {
	const turns: Attribution[] = [];
	let current: Attribution | undefined;
	for (const event of events) {
		if (event.kind === 'user-text') {
			current = { prompt: event.text, at: event.timestamp, edits: [], reads: [] };
			turns.push(current);
			continue;
		}
		if (event.kind !== 'tool-use' || !current) {
			continue;
		}
		const path = filePathOf(event.input);
		if (!path) {
			continue;
		}
		if (WRITE_TOOLS.has(event.toolName)) {
			current.edits.push({ path, toolName: event.toolName, at: event.timestamp });
		} else if (READ_TOOLS.has(event.toolName) && !current.reads.includes(path)) {
			current.reads.push(path);
		}
	}
	return turns.filter((turn) => turn.edits.length > 0).reverse();
}

/**
 * いま走っているツール（tasks.md T-192）。
 *
 * 「読み込まれたファイル一覧」（T-023）が済んだ話なら、こちらは**進行中**の話。
 * 結果（`tool-result`）がまだ返っていない呼び出しを、最後のものから探す。
 */
export interface RunningTool {
	toolName: string;
	/** 何に対して実行しているか（ファイル・コマンドなど） */
	target?: string;
	since: number;
}

export function runningTool(events: readonly NimbusEvent[]): RunningTool | undefined {
	const finished = new Set<string>();
	for (const event of events) {
		if (event.kind === 'tool-result') {
			finished.add(event.toolUseId);
		}
	}
	// 後ろから探す。走っているのはたいてい最後に投げたもの
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i];
		if (event.kind === 'turn-result') {
			// ターンが終わっていれば、走っているツールは無い
			return undefined;
		}
		if (event.kind === 'tool-use' && !finished.has(event.toolUseId)) {
			return {
				toolName: event.toolName,
				target: filePathOf(event.input) ?? commandOf(event.input),
				since: event.timestamp
			};
		}
	}
	return undefined;
}

/** Bash など、パスではなくコマンドで「何をしているか」が分かるもの */
function commandOf(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const command = (input as Record<string, unknown>)['command'];
	return typeof command === 'string' && command ? command.replace(/\s+/g, ' ').trim() : undefined;
}

/** サブエージェントの状態を 1 文字の記号にする（一覧で状態を先頭に置くため） */
export function subagentIcon(status: SubagentRun['status']): string {
	switch (status) {
		case 'running':
			return 'sync';
		case 'completed':
			return 'pass';
		case 'failed':
			return 'error';
		case 'killed':
			return 'circle-slash';
		case 'paused':
			return 'debug-pause';
		default:
			return 'circle-outline';
	}
}

/** フックの結果を記号にする。失敗したものが一目で分かることが目的 */
export function hookIcon(run: HookRun): string {
	if (run.outcome === 'error') {
		return 'error';
	}
	if (run.outcome === 'cancelled') {
		return 'circle-slash';
	}
	if (run.outcome === 'success') {
		return 'pass';
	}
	return 'sync';
}

/** 圧縮の効きめを 1 行にする（何が起きたか分からないまま履歴が減るのが一番困る） */
export function describeCompaction(event: CompactionEvent): string {
	const trigger = event.trigger === 'manual' ? '手動' : '自動';
	if (event.postTokens === undefined) {
		return `${trigger} · ${event.preTokens.toLocaleString('en-US')} トークンから`;
	}
	const saved = event.preTokens - event.postTokens;
	const percent = event.preTokens > 0 ? Math.round((saved / event.preTokens) * 100) : 0;
	return `${trigger} · ${event.preTokens.toLocaleString('en-US')} → ${event.postTokens.toLocaleString('en-US')}（${percent}% 削減）`;
}
