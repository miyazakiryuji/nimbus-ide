/**
 * ツリービューの共通土台（tasks.md T-236）。
 *
 * Nimbus のサイドバーには読み取り専用のツリーが並んでいて、どれも
 * 「ノードの木を作って `TreeItem` に写す」だけの同じ形をしている。
 * ドクターが 4 箇所の重複として拾ったので、Webview の `webview/WebviewViewHost.ts` と
 * 同じように土台へ寄せる。
 *
 * **表示の決めごとは持たない。** 何を出すかは各ビューが `nodes()` で決め、
 * ここは木の受け渡しと `TreeItem` への変換だけを引き受ける。
 */
import * as vscode from 'vscode';

/** 各ビューが組み立てるノード。表示に必要なものだけを持つ */
export interface TreeNode {
	label: string;
	description?: string;
	tooltip?: string | vscode.MarkdownString;
	children?: TreeNode[];
	/** `vscode.ThemeIcon` の名前 */
	icon?: string;
	/** メニューの出し分けに使う（`view/item/context` の `viewItem`） */
	contextValue?: string;
	/** クリックで開くファイル。指定すると行が開くようになる */
	resource?: vscode.Uri;
	/**
	 * クリックで実行するコマンド。`resource` の自動オープンより優先する。
	 *
	 * これが無いと、行は**見えているだけで押しても何も起きない**。
	 * 実際に設定タブが丸ごとその状態になっていた（T-244）。
	 */
	command?: { command: string; arguments?: unknown[] };
}

/**
 * 読み取り専用ツリーの土台。
 *
 * 継承側は `nodes()` を実装し、中身が変わったら `refresh()` を呼ぶ。
 * 折りたたみの状態は `children` の有無から決まるので、各ビューで書き分けない。
 */
export abstract class NimbusTreeView implements vscode.TreeDataProvider<TreeNode> {
	private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	/** 画面に出す木の根。中身は継承側が決める */
	protected abstract nodes(): TreeNode[];

	/** 表示を作り直す */
	protected refresh(): void {
		this.emitter.fire(undefined);
	}

	getTreeItem(node: TreeNode): vscode.TreeItem {
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
		if (node.resource) {
			item.resourceUri = node.resource;
			// 一覧から辿れないと「見えているだけ」で終わる
			item.command = { command: 'vscode.open', title: '開く', arguments: [node.resource] };
		}
		if (node.command) {
			item.command = { title: node.label, ...node.command };
		}
		return item;
	}

	getChildren(node?: TreeNode): TreeNode[] {
		return node ? (node.children ?? []) : this.nodes();
	}
}

/** 見出し 1 つと、その下の一覧。空のときの言い回しも各ビューで書き分けない */
export function group(label: string, icon: string, children: TreeNode[], emptyLabel: string): TreeNode {
	return {
		label,
		description: String(children.length),
		icon,
		children: children.length > 0 ? children : [{ label: emptyLabel }]
	};
}
