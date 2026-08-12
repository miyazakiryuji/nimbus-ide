/**
 * 設定タブ（tasks.md T-016）。
 *
 * Claude Code の設定は `settings.json` の階層・権限モード・モデル・MCP・フックに
 * 散っていて、**いま何が効いているか**を 1 か所で見られない。
 * Nimbus が握っている設定（ポリシー・安全・使用量・ピン留め）も同じで、
 * 設定画面を開いて `nimbus.` で検索する形では「効いているか」が読み取れない。
 *
 * ここは**いま効いている値を並べ、選ぶと直せる**場所。
 * 個々の編集画面は既にコマンドとしてあるので、ここはその入口を集めるだけにする。
 */
import * as vscode from 'vscode';
import { describeProfile, findProfile, BUILTIN_PROFILES } from './core/policyProfiles';
import { flattenHooks, type HooksConfig } from './core/hooks';
import { group, NimbusTreeView, type TreeNode } from './views/treeView';

type Node = TreeNode;

/** 設定を読むだけの薄い入れ物。書くのは各コマンドの担当 */
function config(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration('nimbus');
}

function onOff(value: boolean | undefined): string {
	return value ? 'オン' : 'オフ';
}

/** 押すと直せる行。コマンドを持たせる */
function actionNode(label: string, description: string, command: string, icon: string, tooltip?: string): Node {
	return {
		label,
		description,
		icon,
		tooltip: tooltip ?? label,
		contextValue: `nimbusSetting:${command}`
	};
}

export class SettingsViewProvider extends NimbusTreeView {
	private hooks: HooksConfig = {};

	/** フックは `settings.json` にあるので、拡張側が読んで渡す */
	setHooks(hooks: HooksConfig): void {
		this.hooks = hooks;
		this.refresh();
	}

	/** 設定が変わったら出し直す */
	reload(): void {
		this.refresh();
	}

	protected nodes(): Node[] {
		const c = config();
		const profile = findProfile(BUILTIN_PROFILES, c.get<string>('policy.profile'));
		const hookRows = flattenHooks(this.hooks);
		const pinned = c.get<string[]>('context.pinnedFiles') ?? [];
		const agentModels = c.get<Record<string, string>>('agents.models') ?? {};
		const budget = c.get<number>('context.budgetTokens') ?? 0;
		const costLimit = c.get<number>('usage.costLimitUsd') ?? 0;

		return [
			// いま効いている広さを最初に。ここを見落とすと他が読めない
			actionNode(
				'承認ポリシー',
				`${profile.name} — ${describeProfile(profile)}`,
				'nimbus.switchPolicy',
				'shield',
				profile.description
			),
			group(
				'安全',
				'lock',
				[
					{ label: '秘匿ファイルの読み取り遮断', description: onOff(c.get<boolean>('safety.blockProtectedReads') !== false), icon: 'circle-slash' },
					{ label: '送信前の検査', description: onOff(c.get<boolean>('safety.scanBeforeSend') !== false), icon: 'search' },
					{ label: '読み取り専用ツールの自動許可', description: onOff(c.get<boolean>('permissions.autoApproveReadOnly')), icon: 'check' },
					{ label: '承認前に差分を出す', description: onOff(c.get<boolean>('permissions.showDiffBeforeApproval') !== false), icon: 'diff' }
				],
				'（なし）'
			),
			actionNode(
				'フック',
				hookRows.length > 0 ? `${hookRows.length} 件` : '設定なし',
				'nimbus.hooks',
				'zap',
				hookRows.map((row) => `${row.event}: ${row.command}`).join('\n') || 'フックは設定されていません'
			),
			actionNode(
				'常に含めるファイル',
				pinned.length > 0 ? `${pinned.length} 件` : 'なし',
				'nimbus.pinnedFiles',
				'pinned',
				pinned.join('\n') || 'ピン留めはありません'
			),
			actionNode(
				'サブエージェントのモデル',
				Object.keys(agentModels).length > 0 ? `${Object.keys(agentModels).length} 件` : '既定のまま',
				'nimbus.agentModels',
				'chip',
				Object.entries(agentModels).map(([name, model]) => `${name}: ${model}`).join('\n') || '割り当てはありません'
			),
			group(
				'上限',
				'law',
				[
					{ label: '文脈の予算', description: budget > 0 ? `${budget.toLocaleString('en-US')} トークン` : '上限なし', icon: 'symbol-ruler' },
					{ label: '費用の上限', description: costLimit > 0 ? `$${costLimit}` : '上限なし', icon: 'credit-card' },
					{ label: '同時実行の上限', description: String(c.get<number>('tasks.maxConcurrent') ?? 2), icon: 'server-process' }
				],
				'（なし）'
			),
			group(
				'その他',
				'gear',
				[
					{ label: '通知', description: onOff(c.get<boolean>('notifications.enabled') !== false), icon: 'bell' },
					{ label: 'ホットリロード', description: onOff(c.get<boolean>('hotReload.enabled')), icon: 'sync' },
					{
						label: 'Claude Code の実行ファイル',
						description: c.get<string>('claudeCodeExecutable') || '同梱のものを使う',
						icon: 'terminal'
					}
				],
				'（なし）'
			),
			actionNode('設定をまとめて配る', 'スキル・サブエージェント・フック', 'nimbus.exportBundle', 'package'),
			actionNode('配られた設定を読み込む', '', 'nimbus.importBundle', 'cloud-download')
		];
	}
}
