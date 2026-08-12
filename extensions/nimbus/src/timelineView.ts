/**
 * 生イベントの時系列ビューア（tasks.md T-015 / T-184）。
 *
 * `activityView` は畳んで見せる面。こちらは**畳まずに流れてきた順**で並べる面で、
 * 「何回起きたか」「間に何が挟まったか」「どこで失敗したか」を追うために使う。
 * Inbox の T-015（デバッグモード）が求めていたのはこれ。
 */
import type { NimbusEvent } from './events';
import { buildTimeline, countByKind } from './core/audit';
import { group, NimbusTreeView, type TreeNode } from './views/treeView';

type Node = TreeNode;

function time(at: number): string {
	return new Date(at).toLocaleTimeString('ja-JP');
}

export class TimelineViewProvider extends NimbusTreeView {
	private events: readonly NimbusEvent[] = [];

	update(events: readonly NimbusEvent[]): void {
		this.events = events;
		this.refresh();
	}

	protected nodes(): Node[] {
		const rows = buildTimeline(this.events);
		if (rows.length === 0) {
			return [{ label: 'セッションが動き出すと、ここに生の流れが出ます', icon: 'info' }];
		}
		const counts = countByKind(rows);
		return [
			group(
				'内訳',
				'pie-chart',
				counts.map((entry) => ({ label: entry.kind, description: String(entry.count) })),
				'（なし）'
			),
			// 新しいものが上。失敗したものはアイコンで拾えるようにする
			...rows.map((row) => ({
				label: row.label,
				description: [time(row.at), row.detail].filter(Boolean).join(' · '),
				tooltip: row.detail ?? row.label,
				icon: row.failed ? 'error' : 'circle-small'
			}))
		];
	}
}
