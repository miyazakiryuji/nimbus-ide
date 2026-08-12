/**
 * 承認の横断キュー（tasks.md T-010）。
 *
 * セッションが 1 本なら、モーダルがその場で出るので困らない。困るのは**並列に走らせたとき**で、
 * VS Code のモーダルは 1 枚ずつしか出ないため、後ろで何本のセッションが止まっているのかが
 * 画面のどこにも出ない。放置して他の作業に戻る使いかたでは、これが一番の詰まりどころになる。
 *
 * このビューは走っている全セッションの承認待ちを 1 か所に集め、**危ないものから順に**並べる。
 * 設定 `nimbus.permissions.queueApprovals` を有効にすると、モーダルを出さずにここへ積み、
 * 行のボタンで順に片付けられる（既定は無効＝これまでどおりモーダル）。
 */
import * as vscode from 'vscode';
import type { PendingApproval } from './permissions';
import type { RiskLevel } from './core/risk';
import { sortApprovals, waitedLabel } from './core/approvalQueue';

const RISK_ICON: Record<RiskLevel, { id: string; color?: string }> = {
	danger: { id: 'alert', color: 'list.errorForeground' },
	caution: { id: 'warning', color: 'list.warningForeground' },
	normal: { id: 'shield' }
};

const RISK_LABEL: Record<RiskLevel, string> = { danger: '危険', caution: '注意', normal: '' };

const EMPTY: PendingApproval[] = [];

export class ApprovalsViewProvider implements vscode.TreeDataProvider<PendingApproval>, vscode.Disposable {
	private pending: readonly PendingApproval[] = EMPTY;
	private readonly emitter = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this.emitter.event;
	/** 待ち時間の表示を進めるための刻み。待っているものが無いあいだは動かさない */
	private ticker?: ReturnType<typeof setInterval>;

	constructor(private readonly now: () => number = Date.now) { }

	update(pending: readonly PendingApproval[]): void {
		this.pending = sortApprovals(pending);
		this.emitter.fire();
		if (this.pending.length > 0 && !this.ticker) {
			this.ticker = setInterval(() => this.emitter.fire(), 5000);
		} else if (this.pending.length === 0 && this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
	}

	list(): readonly PendingApproval[] {
		return this.pending;
	}

	getTreeItem(entry: PendingApproval): vscode.TreeItem {
		const item = new vscode.TreeItem(entry.summary, vscode.TreeItemCollapsibleState.None);
		const risk = RISK_LABEL[entry.risk];
		item.description = [risk, waitedLabel(entry.since, this.now())].filter(Boolean).join(' · ');
		const icon = RISK_ICON[entry.risk];
		item.iconPath = new vscode.ThemeIcon(icon.id, icon.color ? new vscode.ThemeColor(icon.color) : undefined);
		item.tooltip = new vscode.MarkdownString(
			[
				`**${entry.toolName}**`,
				'',
				'```',
				entry.summary,
				'```',
				`セッション: \`${entry.sessionId}\``,
				entry.rule ? `「今後この種類は常に許可」にすると: \`${entry.rule}\`` : ''
			]
				.filter(Boolean)
				.join('\n')
		);
		// ルールを作れるものだけ「今後は常に許可」を出す（押せるのに効かない選択肢を見せない）
		item.contextValue = entry.rule ? 'nimbusApproval nimbusApprovalRule' : 'nimbusApproval';
		item.id = entry.id;
		return item;
	}

	getChildren(entry?: PendingApproval): PendingApproval[] {
		return entry ? [] : [...this.pending];
	}

	dispose(): void {
		if (this.ticker) {
			clearInterval(this.ticker);
			this.ticker = undefined;
		}
		this.emitter.dispose();
	}
}
