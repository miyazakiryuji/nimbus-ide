/**
 * 「いま Claude に何が渡っているのか」を一覧するツリー。
 *
 * エージェントを操縦するうえで、モデル・作業ディレクトリ・使えるツール・読み込まれる
 * CLAUDE.md といった前提が見えないと、出力の良し悪しを判断できない。
 * ここは init メッセージ（session-init）から得られる事実だけを並べる。
 */
import { homedir } from 'os';
import type { SessionInitEvent } from './events';
import { billingModeLabel } from './billing';
import { findClaudeMdFiles } from './core/claudeMd';
import { classifyOrigin, displayLabel } from './core/claudeMdDoc';
import { NimbusTreeView, type TreeNode } from './views/treeView';

type Node = TreeNode;

/** CLAUDE.md の出どころ。直す場所を間違えると他のプロジェクトまで巻き込むので、必ず添える */
const ORIGIN_LABEL = {
	project: 'プロジェクト',
	ancestor: '親フォルダから継承',
	user: 'ユーザー設定'
} as const;

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

export class ContextViewProvider extends NimbusTreeView {
	private init?: SessionInitEvent;

	update(init: SessionInitEvent | undefined): void {
		this.init = init;
		this.refresh();
	}

	protected nodes(): Node[] {
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
					? claudeMd.map((path) => ({
						label: displayLabel(path, init.cwd, homedir()),
						// パスの羅列では「どれを直せばいいか」が読み取れない。出どころを添える
						description: ORIGIN_LABEL[classifyOrigin(path, init.cwd, homedir())],
						tooltip: path
					}))
					: [{ label: '（なし）' }]
			}
		];
	}
}
