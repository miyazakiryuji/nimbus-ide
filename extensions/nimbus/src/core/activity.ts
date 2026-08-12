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
