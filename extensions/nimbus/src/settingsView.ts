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
		contextValue: `nimbusSetting:${command}`,
		command: { command }
	};
}

/**
 * いま効いている値の行。押すと、その設定を直す場所（設定画面）が開く。
 *
 * その場で書き換えないのは、ここが**入口を集める場所**だから（ファイル冒頭の方針）。
 * 行ごとに「押したら値が変わる／押したら画面が開く」が混ざると、
 * どちらか分からないまま押すことになる。
 */
function settingNode(label: string, description: string, icon: string, setting: string): Node {
	return {
		label,
		description,
		icon,
		tooltip: `${label}（${setting}）`,
		contextValue: `nimbusSetting:${setting}`,
		command: { command: 'workbench.action.openSettings', arguments: [setting] }
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
					settingNode('秘匿ファイルの読み取り遮断', onOff(c.get<boolean>('safety.blockProtectedReads') !== false), 'circle-slash', 'nimbus.safety.blockProtectedReads'),
					settingNode('送信前の検査', onOff(c.get<boolean>('safety.scanBeforeSend') !== false), 'search', 'nimbus.safety.scanBeforeSend'),
					settingNode('読み取り専用ツールの自動許可', onOff(c.get<boolean>('permissions.autoApproveReadOnly')), 'check', 'nimbus.permissions.autoApproveReadOnly'),
					settingNode('承認前に差分を出す', onOff(c.get<boolean>('permissions.showDiffBeforeApproval') !== false), 'diff', 'nimbus.permissions.showDiffBeforeApproval')
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
					settingNode('文脈の予算', budget > 0 ? `${budget.toLocaleString('en-US')} トークン` : '上限なし', 'symbol-ruler', 'nimbus.context.budgetTokens'),
					settingNode('費用の上限', costLimit > 0 ? `$${costLimit}` : '上限なし', 'credit-card', 'nimbus.usage.costLimitUsd'),
					settingNode('同時実行の上限', String(c.get<number>('tasks.maxConcurrent') ?? 2), 'server-process', 'nimbus.tasks.maxConcurrent')
				],
				'（なし）'
			),
			group(
				'その他',
				'gear',
				[
					settingNode('通知', onOff(c.get<boolean>('notifications.enabled') !== false), 'bell', 'nimbus.notifications.enabled'),
					settingNode('ホットリロード', onOff(c.get<boolean>('hotReload.enabled')), 'sync', 'nimbus.hotReload.enabled'),
					settingNode(
						'Claude Code の実行ファイル',
						c.get<string>('claudeCodeExecutable') || '同梱のものを使う',
						'terminal',
						'nimbus.claudeCodeExecutable'
					)
				],
				'（なし）'
			),
			actionNode('設定をまとめて配る', 'スキル・サブエージェント・フック', 'nimbus.exportBundle', 'package'),
			actionNode('配られた設定を読み込む', '', 'nimbus.importBundle', 'cloud-download')
		];
	}
}
