/**
 * MCP サーバーのビュー（tasks.md T-029 / T-042）。
 *
 * 「繋がっていない」ことは `contextView` でも分かるが、そこからは何もできない。
 * ここは**手を打てる場所** — 繋ぎ直す・切る・提供ツールを見る。
 * 困っているサーバー（失敗・認証待ち）を上に置く。
 */
import * as vscode from 'vscode';
import { describeServer, sortServers, statusIcon, toolBadge, type McpServer } from './core/mcp';

type Node = {
	label: string;
	description?: string;
	tooltip?: string;
	children?: Node[];
	icon?: string;
	/** メニュー（繋ぎ直し・有効／無効）の出し分けに使う */
	contextValue?: string;
	server?: McpServer;
};

export class McpViewProvider implements vscode.TreeDataProvider<Node> {
	private servers: McpServer[] = [];
	private started = false;
	private readonly emitter = new vscode.EventEmitter<Node | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	update(servers: McpServer[]): void {
		this.servers = servers;
		this.started = true;
		this.emitter.fire(undefined);
	}

	clear(): void {
		this.servers = [];
		this.started = false;
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
		if (node.contextValue) {
			item.contextValue = node.contextValue;
		}
		return item;
	}

	getChildren(node?: Node): Node[] {
		if (node) {
			return node.children ?? [];
		}
		if (!this.started) {
			return [{ label: 'セッションを開始すると、ここに MCP サーバーが表示されます', icon: 'info' }];
		}
		if (this.servers.length === 0) {
			return [{ label: 'MCP サーバーは設定されていません', icon: 'info' }];
		}
		return sortServers(this.servers).map((server) => this.serverNode(server));
	}

	private serverNode(server: McpServer): Node {
		const children: Node[] = [];
		if (server.serverInfo) {
			children.push({
				label: 'サーバー',
				description: `${server.serverInfo.name} ${server.serverInfo.version}`,
				icon: 'server'
			});
		}
		if (server.error) {
			// 繋がらない理由が読めないと、直しようがない
			children.push({ label: 'エラー', description: server.error, tooltip: server.error, icon: 'error' });
		}
		const tools = server.tools ?? [];
		children.push({
			label: 'ツール',
			description: String(tools.length),
			icon: 'tools',
			children:
				tools.length > 0
					? tools.map((tool) => ({
						label: tool.name,
						description: [toolBadge(tool.annotations), tool.description].filter(Boolean).join(' · '),
						tooltip: tool.description ?? tool.name,
						icon: tool.annotations?.destructive ? 'warning' : 'symbol-method'
					}))
					: [{ label: '（なし）' }]
		});
		return {
			label: server.name,
			description: describeServer(server),
			tooltip: `${server.name} — ${describeServer(server)}`,
			icon: statusIcon(server.status),
			// 有効／無効で出すメニューを変える
			contextValue: server.status === 'disabled' ? 'nimbusMcpServerDisabled' : 'nimbusMcpServer',
			server,
			children
		};
	}
}
