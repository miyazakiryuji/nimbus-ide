/**
 * 「いま Claude に何が渡っているのか」を一覧するツリー。
 *
 * エージェントを操縦するうえで、モデル・作業ディレクトリ・使えるツール・読み込まれる
 * CLAUDE.md といった前提が見えないと、出力の良し悪しを判断できない。
 * ここは init メッセージ（session-init）から得られる事実だけを並べる。
 */
import { homedir } from 'os';
import * as vscode from 'vscode';
import type { SessionInitEvent } from './events';
import { billingModeLabel } from './billing';
import { findClaudeMdFiles } from './core/claudeMd';

type Node = { label: string; description?: string; tooltip?: string; children?: Node[]; icon?: string };

function listNode(label: string, items: string[], icon: string): Node {
	return {
		label,
		description: String(items.length),
		icon,
		children: items.length > 0
			? items.map((name) => ({ label: name }))
			: [{ label: '（なし）' }]
	};
}

export class ContextViewProvider implements vscode.TreeDataProvider<Node> {
	private init?: SessionInitEvent;
	private readonly emitter = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	update(init: SessionInitEvent | undefined): void {
		this.init = init;
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
		return item;
	}

	getChildren(node?: Node): Node[] {
		if (node) {
			return node.children ?? [];
		}
		const init = this.init;
		if (!init) {
			return [{ label: 'セッションを開始すると、ここに文脈が表示されます', icon: 'info' }];
		}

		const claudeMd = findClaudeMdFiles(init.cwd);
		return [
			{
				label: '課金モード',
				description: billingModeLabel(init.apiKeySource),
				icon: 'credit-card',
				tooltip: `apiKeySource=${init.apiKeySource}`
			},
			{ label: 'モデル', description: init.model, icon: 'chip' },
			{ label: '作業ディレクトリ', description: init.cwd, icon: 'folder', tooltip: init.cwd },
			{ label: '権限モード', description: init.permissionMode, icon: 'shield' },
			{ label: 'Claude Code', description: init.claudeCodeVersion, icon: 'versions' },
			listNode('ツール', init.tools, 'tools'),
			listNode('スキル', init.skills, 'lightbulb'),
			listNode('スラッシュコマンド', init.slashCommands, 'terminal'),
			listNode('サブエージェント', init.agents ?? [], 'organization'),
			{
				label: 'MCP サーバー',
				description: String(init.mcpServers.length),
				icon: 'server',
				children: init.mcpServers.length > 0
					? init.mcpServers.map((s) => ({ label: s.name, description: s.status }))
					: [{ label: '（なし）' }]
			},
			{
				label: 'プラグイン',
				description: String(init.plugins.length),
				icon: 'extensions',
				children: init.plugins.length > 0
					? init.plugins.map((p) => ({ label: p.name, description: p.version }))
					: [{ label: '（なし）' }]
			},
			{
				label: 'CLAUDE.md',
				description: String(claudeMd.length),
				icon: 'book',
				tooltip: '作業ディレクトリから上へ辿って見つかったもの＋ユーザー設定',
				children: claudeMd.length > 0
					? claudeMd.map((path) => ({ label: path.replace(homedir(), '~'), tooltip: path }))
					: [{ label: '（なし）' }]
			}
		];
	}
}
