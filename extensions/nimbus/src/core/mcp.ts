/**
 * MCP サーバーの見せかたと操作の判断（tasks.md T-029 / T-042）。
 *
 * MCP は「繋がらないときに何も分からない」のが一番つらい。
 * 状態・出どころ・エラー・提供ツールを 1 か所に出し、繋ぎ直しをその場でできるようにする。
 *
 * VS Code にも SDK にも依存しない（構造だけを受け取る）ので単体で検証できる。
 */

/** SDK の `McpServerStatus` と構造互換（必要なものだけ） */
export interface McpServer {
	name: string;
	status: 'connected' | 'failed' | 'needs-auth' | 'pending' | 'disabled';
	serverInfo?: { name: string; version: string };
	error?: string;
	scope?: string;
	tools?: { name: string; description?: string; annotations?: { readOnly?: boolean; destructive?: boolean } }[];
}

/** 状態を利用者の言葉にする（`needs-auth` のままでは何をすればいいか分からない） */
export function statusLabel(status: McpServer['status']): string {
	switch (status) {
		case 'connected':
			return '接続済み';
		case 'failed':
			return '接続失敗';
		case 'needs-auth':
			return '認証が必要';
		case 'pending':
			return '接続中';
		case 'disabled':
			return '無効';
	}
}

export function statusIcon(status: McpServer['status']): string {
	switch (status) {
		case 'connected':
			return 'pass';
		case 'failed':
			return 'error';
		case 'needs-auth':
			return 'key';
		case 'pending':
			return 'sync';
		case 'disabled':
			return 'circle-slash';
	}
}

/**
 * 手を打てる状態か。繋ぎ直しても意味が無い状態にボタンを出さない
 * （押しても何も起きないボタンは、壊れているのと同じ）。
 */
export function canReconnect(status: McpServer['status']): boolean {
	return status === 'failed' || status === 'needs-auth' || status === 'connected';
}

/**
 * 困っているサーバーを先に見せる並び。
 * 失敗 → 認証待ち → 接続中 → 接続済み → 無効。同順なら名前順。
 */
const STATUS_ORDER: Record<McpServer['status'], number> = {
	failed: 0,
	'needs-auth': 1,
	pending: 2,
	connected: 3,
	disabled: 4
};

export function sortServers(servers: readonly McpServer[]): McpServer[] {
	return [...servers].sort(
		(a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name)
	);
}

/** ツールの性質を短く出す。破壊的なものが混ざっていることは、使う前に見えているべき */
export function toolBadge(annotations?: { readOnly?: boolean; destructive?: boolean }): string {
	if (annotations?.destructive) {
		return '破壊的';
	}
	if (annotations?.readOnly) {
		return '読み取り専用';
	}
	return '';
}

/** サーバー 1 台のまとめ（一覧の右側に出す 1 行） */
export function describeServer(server: McpServer): string {
	const parts = [statusLabel(server.status)];
	if (server.scope) {
		parts.push(server.scope);
	}
	if (server.status === 'connected') {
		parts.push(`ツール ${server.tools?.length ?? 0}`);
	}
	if (server.error) {
		parts.push(server.error);
	}
	return parts.join(' · ');
}
