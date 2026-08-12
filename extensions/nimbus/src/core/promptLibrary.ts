/**
 * プロンプトライブラリ（tasks.md T-035）。
 *
 * 「このファイルをレビューして。観点は…」のような定型は、毎回打ち直すには長すぎて、
 * 覚えておくには細かすぎる。**変数を空けた形で保存**し、呼び出すときに埋める。
 *
 * `core/sessionPresets.ts` の `{input}` は「入力を 1 つ差し込む」ためのもので、
 * こちらは**名前つきの変数を複数**扱う。似ているが、埋める体験が違う
 * （前者は 1 行、後者はフォーム）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface PromptTemplate {
	name: string;
	/** `{{対象ファイル}}` のような変数を含む本文 */
	body: string;
	description?: string;
}

/** `{{名前}}`。名前に空白と `}` は入れられない */
const VARIABLE = /\{\{\s*([^}\s][^}]*?)\s*\}\}/g;

/**
 * 本文に出てくる変数を、**出てきた順**に重複なく返す。
 * 順番が入力フォームの順番になるので、並べ替えない（書いた人の意図がその順）。
 */
export function extractVariables(body: string): string[] {
	const names: string[] = [];
	for (const match of body.matchAll(VARIABLE)) {
		const name = match[1].trim();
		if (name && !names.includes(name)) {
			names.push(name);
		}
	}
	return names;
}

/**
 * 変数を埋める。
 * **埋まらなかった変数はそのまま残す**（空文字にすると、何が抜けたか分からなくなる）。
 */
export function fillTemplate(body: string, values: Readonly<Record<string, string>>): string {
	return body.replace(VARIABLE, (whole, rawName: string) => {
		const name = rawName.trim();
		const value = values[name];
		return value === undefined || value === '' ? whole : value;
	});
}

/** 埋め残しがあるか。送る前に気づけるようにする */
export function missingVariables(body: string, values: Readonly<Record<string, string>>): string[] {
	return extractVariables(body).filter((name) => !values[name]);
}

/** 名前の重複を許さない（どちらが呼ばれるか読めなくなる） */
export function upsertTemplate(templates: readonly PromptTemplate[], template: PromptTemplate): PromptTemplate[] {
	return [...templates.filter((existing) => existing.name !== template.name), template];
}

export function removeTemplate(templates: readonly PromptTemplate[], name: string): PromptTemplate[] {
	return templates.filter((template) => template.name !== name);
}

/**
 * 出荷時に入れておくもの。**空から始めさせない** —
 * 変数の書き方（`{{名前}}`）は、例が 1 つあれば伝わる。
 */
export const BUILTIN_TEMPLATES: readonly PromptTemplate[] = [
	{
		name: 'レビューを頼む',
		description: '観点を決めて、根拠つきで指摘してもらう',
		body: '{{対象ファイル}} を次の観点でレビューしてください。\n\n観点: {{観点}}\n\n指摘には根拠となる行を添えてください。直すかどうかは私が決めるので、勝手に変更しないでください。'
	},
	{
		name: 'バグを調べる',
		description: '症状から原因を絞り込んでもらう',
		body: '次の症状の原因を調べてください。\n\n症状: {{症状}}\n再現手順: {{再現手順}}\n\nまず原因の見当を述べ、根拠を示してから直してください。'
	},
	{
		name: 'テストを足す',
		description: '既存の書き方に合わせてテストを足す',
		body: '{{対象ファイル}} にテストを足してください。\n\n特に確かめたいこと: {{確かめたいこと}}\n\n既存のテストの書き方に合わせてください。新しい流儀を持ち込まないでください。'
	}
];

/** 一覧に出す説明 */
export function describeTemplate(template: PromptTemplate): string {
	const variables = extractVariables(template.body);
	return [template.description, variables.length > 0 ? `変数 ${variables.length}` : '変数なし']
		.filter(Boolean)
		.join(' · ');
}
