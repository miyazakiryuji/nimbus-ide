/**
 * セッションの開始条件（tasks.md T-148）と、分岐・復元の材料（T-036 / T-150）。
 *
 * 「調査用（読み取りだけ・軽いモデル）」「実装用（書き込みあり）」のように、
 * よく使う始め方は数種類しかない。毎回モデルと権限を選び直すのは無駄だし、選び忘れる。
 *
 * VS Code にも SDK にも依存しないので単体で検証できる。
 */

export interface SessionPreset {
	name: string;
	/** 省略時は既定のモデル */
	model?: string;
	/** SDK の permissionMode。省略時は 'default' */
	permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
	/** 開始時に送る指示。`{input}` があれば呼び出し時の入力で置き換える */
	prompt?: string;
}

/**
 * 出荷時に入れておくもの。
 * **空の状態から始めさせない** — 何を作れるか分からないと、この機能は使われない。
 */
export const BUILTIN_PRESETS: readonly SessionPreset[] = [
	{
		name: '調査（書き換えない）',
		permissionMode: 'plan',
		prompt: '次のことを調べて、分かったことと根拠を報告してください。コードは変更しないでください。\n\n{input}'
	},
	{
		name: '実装',
		permissionMode: 'default',
		prompt: '{input}'
	},
	{
		name: 'レビュー',
		permissionMode: 'plan',
		prompt: '次の観点でレビューしてください。指摘は根拠となる行を添えてください。変更はしないでください。\n\n{input}'
	}
];

/** 名前の重複を許さない。同じ名前が 2 つあると、どちらが呼ばれるか読めない */
export function upsertPreset(presets: readonly SessionPreset[], preset: SessionPreset): SessionPreset[] {
	const rest = presets.filter((existing) => existing.name !== preset.name);
	return [...rest, preset];
}

export function removePreset(presets: readonly SessionPreset[], name: string): SessionPreset[] {
	return presets.filter((preset) => preset.name !== name);
}

/**
 * 実際に送る文を組み立てる。
 * `{input}` が無いテンプレートには、末尾に入力を足す（黙って捨てない）。
 */
export function applyPreset(preset: SessionPreset, input: string): string {
	const template = preset.prompt ?? '{input}';
	if (template.includes('{input}')) {
		return template.split('{input}').join(input).trim();
	}
	return input ? `${template}\n\n${input}`.trim() : template.trim();
}

/** 一覧に出す説明 */
export function describePreset(preset: SessionPreset): string {
	return [preset.model, preset.permissionMode ?? 'default'].filter(Boolean).join(' · ');
}

/**
 * 分岐で使う名前（T-036）。同じ地点から複数の案を走らせるので、
 * **どれがどの案か**が一目で分かる必要がある。
 */
export function branchTitle(baseTitle: string, index: number): string {
	// A 案・B 案…。3 案を超えたら数字に落とす
	const labels = ['A', 'B', 'C', 'D', 'E'];
	const label = labels[index] ?? String(index + 1);
	return `${baseTitle}（${label} 案）`;
}
