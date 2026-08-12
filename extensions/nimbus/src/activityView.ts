/**
 * 「セッションの中身」ビュー（tasks.md T-018 / T-022 / T-023 / T-027）。
 *
 * サブエージェント・フック・読み込んだファイル・コンパクションを 1 つのツリーに集める。
 * 4 つ別々のビューにするとサイドバーが破綻するし、どれも「いま何が起きたか」を
 * 追うための情報なので、**同じ面にあるほうが読める**。
 *
 * 保持しているイベント列を畳むだけの表示層で、状態は持たない（畳む処理は `core/activity.ts`）。
 */
import * as vscode from 'vscode';
import type { NimbusEvent } from './events';
import {
	buildActivity,
	buildAttributions,
	describeCompaction,
	hookIcon,
	runningTool,
	subagentIcon,
	type Attribution,
	type HookRun,
	type SubagentRun,
	type TouchedFile
} from './core/activity';
import { collectEvidence } from './core/evidence';

type Node = {
	label: string;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	children?: Node[];
	icon?: string;
	/** クリックで開くファイル（読み込まれたファイル一覧から飛ぶ・T-023） */
	resource?: vscode.Uri;
};

function time(at: number): string {
	return new Date(at).toLocaleTimeString('ja-JP');
}

function duration(ms: number | undefined): string {
	if (ms === undefined) {
		return '';
	}
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function subagentNode(run: SubagentRun): Node {
	const children: Node[] = [];
	if (run.prompt) {
		children.push({ label: '指示', description: run.prompt, tooltip: run.prompt, icon: 'comment' });
	}
	if (run.lastToolName) {
		children.push({ label: '最後のツール', description: run.lastToolName, icon: 'tools' });
	}
	if (run.totalTokens !== undefined) {
		children.push({
			label: '消費',
			description: `${run.totalTokens.toLocaleString('en-US')} トークン · ツール ${run.toolUses ?? 0} 回 · ${duration(run.durationMs)}`,
			icon: 'dashboard'
		});
	}
	if (run.summary) {
		children.push({ label: 'まとめ', description: run.summary, tooltip: run.summary, icon: 'note' });
	}
	if (run.error) {
		children.push({ label: 'エラー', description: run.error, tooltip: run.error, icon: 'error' });
	}
	return {
		label: run.description,
		description: [run.subagentType, run.status].filter(Boolean).join(' · '),
		tooltip: `${run.description}\n開始 ${time(run.startedAt)} / 更新 ${time(run.updatedAt)}`,
		icon: subagentIcon(run.status),
		children: children.length > 0 ? children : undefined
	};
}

function hookNode(run: HookRun): Node {
	const children: Node[] = [];
	if (run.output) {
		children.push({ label: '出力', description: run.output, tooltip: run.output, icon: 'output' });
	}
	if (run.stderr) {
		children.push({ label: 'stderr', description: run.stderr, tooltip: run.stderr, icon: 'warning' });
	}
	if (run.exitCode !== undefined) {
		children.push({ label: '終了コード', description: String(run.exitCode), icon: 'symbol-number' });
	}
	return {
		label: run.hookName,
		// 「なんでブロックされたの？」に答えるので、どのイベントで発火したかを前に出す
		description: [run.hookEvent, run.outcome ?? '実行中', time(run.startedAt)].filter(Boolean).join(' · '),
		tooltip: `${run.hookEvent} → ${run.hookName}`,
		icon: hookIcon(run),
		children: children.length > 0 ? children : undefined
	};
}

function fileNode(file: TouchedFile): Node {
	const counts = [file.reads > 0 ? `読 ${file.reads}` : '', file.writes > 0 ? `書 ${file.writes}` : '']
		.filter(Boolean)
		.join(' · ');
	return {
		label: file.path.split('/').pop() ?? file.path,
		description: `${counts} · ${time(file.lastAt)}`,
		tooltip: file.path,
		icon: file.writes > 0 ? 'edit' : 'file',
		resource: vscode.Uri.file(file.path)
	};
}

/** 1 つの指示と、そこから生まれた修正（T-024） */
function attributionNode(attribution: Attribution): Node {
	const prompt = attribution.prompt.replace(/\s+/g, ' ').trim();
	const children: Node[] = attribution.edits.map((edit) => ({
		label: edit.path.split('/').pop() ?? edit.path,
		description: `${edit.toolName} · ${time(edit.at)}`,
		tooltip: edit.path,
		icon: 'edit',
		resource: vscode.Uri.file(edit.path)
	}));
	if (attribution.reads.length > 0) {
		// 何を見て決めたかが分かると、修正の妥当性を判断できる
		children.push({
			label: '読んだファイル',
			description: String(attribution.reads.length),
			icon: 'file',
			children: attribution.reads.map((path) => ({
				label: path.split('/').pop() ?? path,
				tooltip: path,
				resource: vscode.Uri.file(path)
			}))
		});
	}
	return {
		label: prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt,
		description: `${attribution.edits.length} 件の修正 · ${time(attribution.at)}`,
		tooltip: attribution.prompt,
		icon: 'comment-discussion',
		children
	};
}

function group(label: string, icon: string, children: Node[], emptyLabel: string): Node {
	return {
		label,
		description: String(children.length),
		icon,
		children: children.length > 0 ? children : [{ label: emptyLabel }]
	};
}

export class ActivityViewProvider implements vscode.TreeDataProvider<Node> {
	private events: readonly NimbusEvent[] = [];
	private readonly emitter = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	/** 表示のもとになるイベント列を差し替える（拡張側が保持しているものをそのまま渡す） */
	update(events: readonly NimbusEvent[]): void {
		this.events = events;
		this.emitter.fire(undefined);
	}

	getTreeItem(node: Node): vscode.TreeItem {
		const item = new vscode.TreeItem(
			node.label,
			node.children ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
		);
		item.description = node.description;
		item.tooltip = node.tooltip ?? node.label;
		if (node.icon) {
			item.iconPath = new vscode.ThemeIcon(node.icon);
		}
		if (node.resource) {
			item.resourceUri = node.resource;
			// クリックでエディタに飛ぶ。一覧から辿れないと「見えているだけ」で終わる
			item.command = { command: 'vscode.open', title: '開く', arguments: [node.resource] };
		}
		return item;
	}

	getChildren(node?: Node): Node[] {
		if (node) {
			return node.children ?? [];
		}
		const activity = buildActivity(this.events);
		if (
			activity.subagents.length === 0 &&
			activity.hooks.length === 0 &&
			activity.files.length === 0 &&
			activity.compactions.length === 0
		) {
			return [{ label: 'セッションが動き出すと、ここに中身が表示されます', icon: 'info' }];
		}
		const nodes: Node[] = [];
		// いま何をしているかは一番上に。走っている間だけ出す（T-192）
		const running = runningTool(this.events);
		if (running) {
			nodes.push({
				label: `いま: ${running.toolName}`,
				description: running.target ?? '',
				tooltip: running.target ?? running.toolName,
				icon: 'sync~spin'
			});
		}
		nodes.push(
			group('指示ごとの修正', 'comment-discussion', buildAttributions(this.events).map(attributionNode), '（まだありません）'),
			group('サブエージェント', 'organization', activity.subagents.map(subagentNode), '（まだ動いていません）'),
			group('フック', 'zap', activity.hooks.map(hookNode), '（発火していません）'),
			group('触ったファイル', 'files', activity.files.map(fileNode), '（まだありません）'),
			// 「動いた気がする」を排除するための材料（T-081）
			group(
				'テストの証跡',
				'beaker',
				collectEvidence(this.events).runs.map((run) => ({
					label: run.command,
					description: `${run.outcome === 'passed' ? '成功' : run.outcome === 'failed' ? '失敗' : '判定できず'} · ${time(run.at)}`,
					tooltip: run.output,
					icon: run.outcome === 'passed' ? 'pass' : run.outcome === 'failed' ? 'error' : 'question'
				})),
				'（テストを実行していません）'
			),
			group(
				'コンパクション',
				'fold',
				activity.compactions.map((event) => ({
					label: time(event.timestamp),
					description: describeCompaction(event),
					icon: 'fold'
				})),
				'（発生していません）'
			)
		);
		return nodes;
	}
}
