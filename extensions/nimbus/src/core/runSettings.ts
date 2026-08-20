/**
 * いま話しているセッションの「走らせかた」— モデルとエフォート（tasks.md T-291）。
 *
 * サブエージェントへのモデル割り当て（T-232 / `nimbus.agents.models`）とは別物。
 * こちらは**目の前の会話そのもの**をどのモデル・どの思考量で回すかで、
 * 途中で変えられる（SDK の `setModel` / `applyFlagSettings`）。
 *
 * **候補は必ず SDK から引く。** モデルごとに使えるエフォートが違い、
 * 手で並べた一覧は必ず古くなる。ここは受け取ったものを画面用に整えるだけ（VS Code 非依存）。
 */

/** SDK の `ModelInfo` のうち、Nimbus が使うぶん */
export interface SdkModelInfo {
	value: string;
	resolvedModel?: string;
	displayName?: string;
	description?: string;
	supportsEffort?: boolean;
	supportedEffortLevels?: readonly string[];
}

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** 選べるエフォートの並び。**弱い順**（強い順にすると「最大」が既定に見える） */
export const EFFORT_ORDER: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * エフォートの日本語。**強さの並びが字面でも分かる語**を選ぶ
 * （「速い / 賢い」のような別の軸の言葉を混ぜない）。
 */
export const EFFORT_LABELS: Record<EffortLevel, string> = {
	low: '低',
	medium: '中',
	high: '高',
	xhigh: '特高',
	max: '最大'
};

export interface ModelOption {
	/** SDK に渡す値 */
	value: string;
	/** 画面に出す名前 */
	label: string;
	/** 添える説明（無ければ空） */
	description: string;
	/** そのモデルで選べるエフォート（空 = エフォートを持たないモデル） */
	efforts: readonly EffortLevel[];
}

function knownEfforts(levels: readonly string[] | undefined): readonly EffortLevel[] {
	if (!levels) {
		return [];
	}
	// 知らない段は落とす。SDK が段を増やしたときに、画面に生の英語が出るのを防ぐ
	return EFFORT_ORDER.filter((level) => levels.includes(level));
}

/**
 * SDK の一覧を、そのまま選ばせられる形にする。
 *
 * `displayName` が無いものは `value` で出す — **空欄にしない**。
 * 名前が出ないと、どれを選んだのか分からないまま切り替えることになる。
 */
export function toModelOptions(models: readonly SdkModelInfo[] | undefined): ModelOption[] {
	return (models ?? [])
		.filter((model) => typeof model?.value === 'string' && model.value.length > 0)
		.map((model) => ({
			value: model.value,
			label: model.displayName?.trim() || model.value,
			description: model.description?.trim() ?? '',
			efforts: model.supportsEffort === false ? [] : knownEfforts(model.supportedEffortLevels)
		}));
}

/**
 * いまのモデルに当たる行を探す。
 *
 * セッションが名乗る id（`claude-opus-5[1m]` など）と、一覧の `value`（`opus` などの別名）は
 * 一致しないことがあるので、**`resolvedModel` と前方一致でも拾う**。
 */
export function findModel(
	models: readonly SdkModelInfo[] | undefined,
	current: string | undefined
): SdkModelInfo | undefined {
	if (!current) {
		return undefined;
	}
	const list = models ?? [];
	// 打った値そのものなら、それが答え（`default` を選んだなら「既定」と出してよい）
	const literal = list.find((model) => model.value === current);
	if (literal) {
		return literal;
	}
	// **`default` の行は名前として使わない。**
	// 実物の一覧では `default` の `resolvedModel` が `claude-opus-5[1m]` — つまり
	// セッションが名乗る id と**完全一致**するので、素直に探すと必ず先に当たり、
	// 画面には「Default (recommended)」とだけ出る（どのモデルで走っているのか分からない）。
	const named = list.filter((model) => model.value !== 'default');
	const resolved = named.find((model) => model.resolvedModel === current);
	if (resolved) {
		return resolved;
	}
	// 後ろ足し（`[1m]` など）が付いた形も拾う。当たりが複数なら長いほうを採る
	const prefixed = named
		.map((model) => ({ model, key: model.resolvedModel ?? model.value }))
		.filter((entry) => entry.key.length > 0 && current.startsWith(entry.key))
		.sort((a, b) => b.key.length - a.key.length);
	return prefixed[0]?.model;
}

/** 帯に出すモデルの名前。分からないときは生の id を出す（空欄にしない） */
export function modelLabel(
	models: readonly SdkModelInfo[] | undefined,
	current: string | undefined
): string | undefined {
	if (!current) {
		return undefined;
	}
	return findModel(models, current)?.displayName?.trim() || current;
}

/** 帯に出すエフォート。未設定のときは「既定」と言う（空欄にしない） */
export function effortLabel(effort: string | undefined): string {
	const known = EFFORT_ORDER.find((level) => level === effort);
	return known ? EFFORT_LABELS[known] : '既定';
}

/** そのモデルで選べるエフォート。持たないモデルでは空 */
export function effortsFor(
	models: readonly SdkModelInfo[] | undefined,
	current: string | undefined
): readonly EffortLevel[] {
	const model = findModel(models, current);
	if (!model || model.supportsEffort === false) {
		return [];
	}
	return knownEfforts(model.supportedEffortLevels);
}
