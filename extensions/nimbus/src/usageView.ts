/**
 * 使用量ダッシュボード（tasks.md T-017 / T-020 / T-037）。
 *
 * 「あとどれだけ使えるか」を、走らせている最中に見える場所へ置く。
 * 枠は 1 本にまとめない — 5 時間の枠・週の枠（対話）・週の枠（アプリ経由）は
 * 別々に消費されるので、合算すると「まだ余裕がある」と誤読する。
 *
 * 表示は `contextView` と同じくツリー。ゲージは文字で描く（Webview を足すほどの
 * 情報量ではないうえ、ツリーなら折りたたんで置いておける）。
 */
import type { SDKControlGetContextUsageResponse, SDKControlGetUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import { budgetGauge, contextGauge, formatCost, formatTokens, toGauges, type Gauge } from './core/usage';
import { contextEfficiency, describeEfficiency } from './core/efficiency';
import type { NimbusEvent } from './events';
import { NimbusTreeView, type TreeNode } from './views/treeView';

type Node = TreeNode;

function gaugeNode(gauge: Gauge, icon: string): Node {
	return {
		label: `${gauge.bar} ${gauge.label}`,
		description: gauge.detail,
		tooltip: `${gauge.label} — ${gauge.detail}`,
		icon
	};
}

export class UsageViewProvider extends NimbusTreeView {
	private usage?: SDKControlGetUsageResponse;
	private context?: SDKControlGetContextUsageResponse;
	private updatedAt?: number;
	/** 効率スコア（T-156）のもと。読み込みの重複はイベント列からしか分からない */
	private events: readonly NimbusEvent[] = [];
	/** 文脈の予算（T-153）。0 なら予算なし */
	private budgetTokens = 0;

	update(
		usage: SDKControlGetUsageResponse | undefined,
		context: SDKControlGetContextUsageResponse | undefined,
		events: readonly NimbusEvent[] = [],
		budgetTokens = 0
	): void {
		this.usage = usage;
		this.context = context;
		this.events = events;
		this.budgetTokens = budgetTokens;
		this.updatedAt = Date.now();
		this.refresh();
	}

	clear(): void {
		this.usage = undefined;
		this.context = undefined;
		this.updatedAt = undefined;
		this.refresh();
	}

	protected nodes(): Node[] {
		if (!this.usage && !this.context) {
			return [{ label: 'セッションを開始すると、ここに使用量が表示されます', icon: 'info' }];
		}

		const nodes: Node[] = [];

		if (this.context) {
			nodes.push(gaugeNode(contextGauge(this.context.totalTokens, this.context.maxTokens), 'symbol-ruler'));
			// 予算は「上限」ではなく「そこへ近づいていること」を伝えるためのもの（T-153）
			const budget = budgetGauge(this.context.totalTokens, this.budgetTokens);
			if (budget) {
				nodes.push(gaugeNode(budget, 'law'));
			}
			// 何が文脈を食っているかが分かると、削る先が決まる
			const categories = [...this.context.categories]
				.filter((category) => category.tokens > 0)
				.sort((a, b) => b.tokens - a.tokens);
			if (categories.length > 0) {
				nodes.push({
					label: '文脈の内訳',
					description: String(categories.length),
					icon: 'pie-chart',
					children: categories.map((category) => ({
						label: category.name,
						description: formatTokens(category.tokens)
					}))
				});
			}
		}

		if (this.usage) {
			const session = this.usage.session;
			nodes.push({
				label: 'このセッションの費用',
				description: formatCost(session.total_cost_usd),
				icon: 'credit-card',
				tooltip: `API 時間 ${Math.round(session.total_api_duration_ms / 1000)} 秒 / 経過 ${Math.round(session.total_duration_ms / 1000)} 秒`
			});

			const gauges = toGauges(this.usage.rate_limits);
			if (gauges.length > 0) {
				nodes.push(...gauges.map((gauge) => gaugeNode(gauge, 'dashboard')));
			} else {
				// 枠が無いのか、取れなかったのかを区別して伝える（黙って空にしない）
				nodes.push({
					label: this.usage.rate_limits_available ? '枠の消費を取得できませんでした' : '枠の制限は適用されません',
					description: this.usage.subscription_type ?? 'API キー利用',
					icon: 'info',
					tooltip: 'API キー・Bedrock・Vertex での利用には、サブスクの 5 時間 / 週の枠がありません'
				});
			}

			const models = Object.entries(session.model_usage);
			if (models.length > 0) {
				nodes.push({
					label: 'モデル別',
					description: String(models.length),
					icon: 'chip',
					children: models.map(([model, usage]) => ({
						label: model,
						description: `${formatCost(usage.costUSD)} · 入 ${formatTokens(usage.inputTokens)} / 出 ${formatTokens(usage.outputTokens)}`,
						tooltip: `キャッシュ読み ${formatTokens(usage.cacheReadInputTokens)} / 作成 ${formatTokens(usage.cacheCreationInputTokens)}`
					}))
				});
			}

			nodes.push({
				label: '変更行数',
				description: `+${session.total_lines_added} / -${session.total_lines_removed}`,
				icon: 'diff'
			});
		}

		// 読み直しの重複は「無駄」と言い切れる唯一の指標（T-156）
		const efficiency = contextEfficiency(this.events);
		if (efficiency.totalReads > 0) {
			nodes.push({
				label: '読み込みの効率',
				description: describeEfficiency(efficiency),
				icon: 'symbol-ruler',
				tooltip: `${efficiency.uniqueFiles} ファイルを ${efficiency.totalReads} 回読みました`,
				children:
					efficiency.worst.length > 0
						? efficiency.worst.map((file) => ({
							label: file.path.split('/').pop() ?? file.path,
							description: `${file.reads} 回`,
							tooltip: file.path
						}))
						: undefined
			});
		}

		if (this.updatedAt) {
			nodes.push({
				label: '取得時刻',
				description: new Date(this.updatedAt).toLocaleTimeString('ja-JP'),
				icon: 'clock'
			});
		}
		return nodes;
	}
}
