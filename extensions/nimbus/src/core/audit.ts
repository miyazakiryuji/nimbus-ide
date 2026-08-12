/**
 * 監査ログと、生イベントの時系列（tasks.md T-050 / T-015 / T-184）。
 *
 * 「誰がどのエージェントに何をさせたか」を後から辿れないと、企業では使えない。
 * ついでに、開発中も「なぜこうなったか」を追うには**畳んでいない生の並び**が要る
 * （`activity.ts` は畳むので、順番と抜けが見えない）。
 *
 * **書き出す前に必ずサニタイザを通す**のは呼び出し側の責任。ここは形を作るだけ。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';

/** 監査に残す 1 行。JSONL として追記する */
export interface AuditRecord {
	at: string;
	sessionId: string;
	kind: NimbusEvent['kind'];
	/** 何に対して（ツール名・ファイル・状態など） */
	subject?: string;
	/** 結果（成功・失敗・拒否） */
	outcome?: string;
	/** 人が読むための一言 */
	detail?: string;
}

/** 監査に残す価値のあるものだけ。表示用の細かいイベントは残さない */
const AUDITED: ReadonlySet<NimbusEvent['kind']> = new Set([
	'session-init',
	'user-text',
	'tool-use',
	'tool-result',
	'turn-result',
	'session-error',
	'subagent',
	'hook',
	'compaction'
]);

const DETAIL_LIMIT = 300;

function trim(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT)}…` : flat;
}

function subjectOf(event: NimbusEvent): string | undefined {
	switch (event.kind) {
		case 'tool-use': {
			const input = event.input as Record<string, unknown> | null;
			const target = input?.['file_path'] ?? input?.['command'] ?? input?.['path'];
			return typeof target === 'string' ? `${event.toolName}: ${trim(target)}` : event.toolName;
		}
		case 'session-init':
			return event.model;
		case 'subagent':
			return event.description ?? event.taskId;
		case 'hook':
			return `${event.hookEvent}: ${event.hookName}`;
		default:
			return undefined;
	}
}

function outcomeOf(event: NimbusEvent): string | undefined {
	switch (event.kind) {
		case 'tool-result':
			return event.isError ? '失敗' : '成功';
		case 'turn-result':
			return event.isError ? `失敗（${event.subtype}）` : '成功';
		case 'subagent':
			return event.status;
		case 'hook':
			return event.outcome;
		case 'session-error':
			return '失敗';
		default:
			return undefined;
	}
}

function detailOf(event: NimbusEvent): string | undefined {
	switch (event.kind) {
		case 'user-text':
			return trim(event.text);
		case 'session-error':
			return trim(event.message);
		case 'tool-result':
			return event.isError ? trim(event.preview) : undefined;
		case 'turn-result':
			return event.totalCostUsd !== undefined ? `累計 $${event.totalCostUsd.toFixed(4)}` : undefined;
		case 'compaction':
			return `${event.trigger} · ${event.preTokens} → ${event.postTokens ?? '?'}`;
		default:
			return undefined;
	}
}

/** イベントを監査 1 行にする。残さないものは `undefined` */
export function toAuditRecord(event: NimbusEvent): AuditRecord | undefined {
	if (!AUDITED.has(event.kind)) {
		return undefined;
	}
	return {
		at: new Date(event.timestamp).toISOString(),
		sessionId: event.sessionId,
		kind: event.kind,
		subject: subjectOf(event),
		outcome: outcomeOf(event),
		detail: detailOf(event)
	};
}

/** JSONL の 1 行にする（追記して使う） */
export function toJsonLine(record: AuditRecord): string {
	return `${JSON.stringify(record)}\n`;
}

/** 生イベント 1 件の 1 行表示（T-015 / T-184 の時系列ビューア用） */
export interface TimelineRow {
	at: number;
	kind: NimbusEvent['kind'];
	label: string;
	detail?: string;
	/** 失敗したものを目立たせるため */
	failed: boolean;
}

/**
 * 畳まずに、**流れてきた順**で並べる。
 * `activity.ts` は同じ ID をまとめるので、「何回起きたか」「間に何が挟まったか」が消える。
 * デバッグではそこが見たい。
 */
export function buildTimeline(events: readonly NimbusEvent[], limit = 300): TimelineRow[] {
	const rows: TimelineRow[] = [];
	for (const event of events) {
		const record = toAuditRecord(event);
		if (!record) {
			continue;
		}
		rows.push({
			at: event.timestamp,
			kind: event.kind,
			label: [record.kind, record.subject].filter(Boolean).join(' · '),
			detail: [record.outcome, record.detail].filter(Boolean).join(' · ') || undefined,
			failed: record.outcome !== undefined && record.outcome.startsWith('失敗')
		});
	}
	// 新しいものを上に。長いセッションでは上限を超えたぶんを落とす
	return rows.reverse().slice(0, limit);
}

/** 種類ごとの件数。何が多いのかが分かると、絞る先が決まる */
export function countByKind(rows: readonly TimelineRow[]): { kind: string; count: number }[] {
	const counts = new Map<string, number>();
	for (const row of rows) {
		counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
	}
	return [...counts.entries()]
		.map(([kind, count]) => ({ kind, count }))
		.sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
}
