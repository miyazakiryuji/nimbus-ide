/**
 * スキル・サブエージェント・コマンドのフロントマターを見る（tasks.md T-030）。
 *
 * これらは**書式を 1 文字間違えると、黙って読み込まれない**。エラーも出ないので、
 * 「書いたのに使われない」と気づくまでに時間がかかる。書いている最中に教えるのが正しい。
 *
 * YAML パーサは持ち込まない（必要なのは先頭のキーと値だけ）。
 * VS Code に依存しないので単体で検証できる。
 */

export type AssetKind = 'skill' | 'agent' | 'command' | 'unknown';

export interface FrontmatterField {
	key: string;
	value: string;
	line: number;
}

export interface FrontmatterProblem {
	line: number;
	message: string;
	severity: 'error' | 'warning';
}

/** 置かれている場所から、何を書いているのかを決める */
export function kindFromPath(path: string): AssetKind {
	const normalized = path.replace(/\\/g, '/');
	if (/\/skills\/[^/]+\/SKILL\.md$/i.test(normalized)) {
		return 'skill';
	}
	if (/\/agents\/[^/]+\.md$/i.test(normalized)) {
		return 'agent';
	}
	if (/\/commands\/[^/]+\.md$/i.test(normalized)) {
		return 'command';
	}
	return 'unknown';
}

/** `---` で囲まれた先頭の塊を読む。無ければ空 */
export function parseFrontmatter(content: string): { fields: FrontmatterField[]; endLine: number } | undefined {
	const lines = content.split('\n');
	if (lines[0]?.trim() !== '---') {
		return undefined;
	}
	const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
	if (end < 0) {
		return undefined;
	}
	const fields: FrontmatterField[] = [];
	for (let i = 1; i < end; i++) {
		const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(lines[i]);
		if (match) {
			fields.push({ key: match[1], value: match[2].trim(), line: i });
		}
	}
	return { fields, endLine: end };
}

interface FieldSpec {
	key: string;
	required: boolean;
	description: string;
	/** 値の書き方の注意（あるときだけ） */
	hint?: string;
}

export const FIELDS: Record<Exclude<AssetKind, 'unknown'>, FieldSpec[]> = {
	skill: [
		{ key: 'name', required: true, description: 'スキルの名前（フォルダ名と揃える）' },
		{
			key: 'description',
			required: true,
			description: 'いつ使うか。**ここが検索に当たる**ので、使いどころを具体的に書く',
			hint: '「〜のときに使う」まで書くと、曖昧な聞き方でも引ける'
		},
		{ key: 'allowed-tools', required: false, description: '使ってよいツール（省略すると全部）' }
	],
	agent: [
		{ key: 'name', required: true, description: 'サブエージェントの名前' },
		{ key: 'description', required: true, description: 'いつ呼ぶか。親はこれを見て呼ぶか決める' },
		{ key: 'tools', required: false, description: '渡すツール（省略すると全部）' },
		{ key: 'model', required: false, description: '使うモデル（省略すると親と同じ）' }
	],
	command: [
		{ key: 'description', required: true, description: 'コマンドの説明（一覧に出る）' },
		{ key: 'argument-hint', required: false, description: '引数の例（入力欄に出る）' },
		{ key: 'allowed-tools', required: false, description: '使ってよいツール' }
	]
};

/**
 * 書式を見る。
 *
 * **足りないものだけを言う。** 知らないキーは黙って通す（将来増えるかもしれないし、
 * 知らないだけで間違いとは限らない）。
 */
export function validateFrontmatter(kind: AssetKind, content: string): FrontmatterProblem[] {
	if (kind === 'unknown') {
		return [];
	}

	const parsed = parseFrontmatter(content);
	if (!parsed) {
		return [
			{
				line: 0,
				severity: 'error',
				message: '先頭に `---` で囲んだフロントマターがありません（無いと読み込まれません）'
			}
		];
	}

	const problems: FrontmatterProblem[] = [];
	const present = new Map(parsed.fields.map((field) => [field.key, field]));

	for (const spec of FIELDS[kind]) {
		const field = present.get(spec.key);
		if (!field) {
			if (spec.required) {
				problems.push({ line: 0, severity: 'error', message: `\`${spec.key}\` がありません — ${spec.description}` });
			}
			continue;
		}
		if (spec.required && field.value.length === 0) {
			problems.push({ line: field.line, severity: 'error', message: `\`${spec.key}\` が空です` });
		}
	}

	const description = present.get('description');
	if (description && description.value.length > 0 && description.value.length < 15) {
		problems.push({
			line: description.line,
			severity: 'warning',
			message: 'description が短すぎます。**検索に当たる場所**なので、いつ使うかを具体的に書いてください'
		});
	}

	return problems;
}

/** 補完の候補（まだ書かれていないキーだけ） */
export function completionsFor(kind: AssetKind, content: string): FieldSpec[] {
	if (kind === 'unknown') {
		return [];
	}
	const parsed = parseFrontmatter(content);
	const present = new Set((parsed?.fields ?? []).map((field) => field.key));
	return FIELDS[kind].filter((spec) => !present.has(spec.key));
}
