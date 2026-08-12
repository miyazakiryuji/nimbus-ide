/**
 * スキル・サブエージェント・コマンドのフロントマターを見る（tasks.md T-030）。
 *
 * これらは**書式を 1 文字間違えると、黙って読み込まれない**。エラーも出ないので、
 * 「書いたのに使われない」と気づくまでに時間がかかる。書いている最中に教えるのが正しい。
 *
 * YAML パーサは持ち込まない（必要なのは先頭のキーと値だけ）。
 * VS Code に依存しないので単体で検証できる。
 */

export type AuthoringKind = 'skill' | 'agent' | 'command';

export interface FieldSpec {
	name: string;
	required: boolean;
	/** 補完に出す説明 */
	description: string;
	/** 値の雛形（キーだけ出しても、何を書くかで手が止まる） */
	example?: string;
}

export interface Problem {
	message: string;
	severity: 'error' | 'warning';
	/** 問題のある行（0 始まり）。ファイル全体に関わるものは 0 */
	line: number;
}

export const FIELDS: Record<AuthoringKind, FieldSpec[]> = {
	skill: [
		{ name: 'name', required: true, description: 'スキルの名前（フォルダ名と揃える）' },
		{
			name: 'description',
			required: true,
			description: 'いつ使うか。ここが検索に当たるので、使いどころを具体的に',
			example: '〜のときに使う'
		},
		{ name: 'allowed-tools', required: false, description: '使ってよいツール（省略すると全部）' }
	],
	agent: [
		{ name: 'name', required: true, description: 'サブエージェントの名前' },
		{ name: 'description', required: true, description: 'いつ呼ぶか。親はこれを見て呼ぶか決める' },
		{ name: 'tools', required: false, description: '渡すツール（省略すると全部）' },
		{ name: 'model', required: false, description: '使うモデル（省略すると親と同じ）' }
	],
	command: [
		{ name: 'description', required: true, description: 'コマンドの説明（一覧に出る）' },
		{ name: 'argument-hint', required: false, description: '引数の例（入力欄に出る）' },
		{ name: 'allowed-tools', required: false, description: '使ってよいツール' }
	]
};

/**
 * 置き場所から種類を決める。
 * **関係ないファイルでは何もしない**（`undefined` を返す）。補完が出ると邪魔になる。
 */
export function kindOfPath(path: string): AuthoringKind | undefined {
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
	return undefined;
}

/** `---` で囲まれた先頭の塊の範囲（文字位置）。無ければ `undefined` */
export function frontmatterRange(content: string): { start: number; end: number } | undefined {
	if (!content.startsWith('---')) {
		return undefined;
	}
	const close = content.indexOf('\n---', 3);
	if (close < 0) {
		return undefined;
	}
	return { start: 0, end: close + 4 };
}

/** その位置がフロントマターの中か（補完を出してよい場所か） */
export function isInsideFrontmatter(content: string, offset: number): boolean {
	const range = frontmatterRange(content);
	return range !== undefined && offset >= range.start && offset <= range.end;
}

/** すでに書かれているキー */
export function writtenKeys(content: string): string[] {
	const range = frontmatterRange(content);
	if (!range) {
		return [];
	}
	const keys: string[] = [];
	for (const line of content.slice(0, range.end).split('\n')) {
		const match = /^([A-Za-z][\w-]*):/.exec(line);
		if (match) {
			keys.push(match[1]);
		}
	}
	return keys;
}

/**
 * まだ書かれていないキーだけを候補にする。
 * **重複したキーは後勝ちで効く**ので、二重に書かせない。
 */
export function completionsFor(kind: AuthoringKind, content: string): FieldSpec[] {
	const written = new Set(writtenKeys(content));
	return FIELDS[kind].filter((field) => !written.has(field.name));
}

/**
 * 足りないものを名指しする。
 *
 * **知らないキーは黙って通す**（将来増えるかもしれないし、知らないだけで間違いとは限らない）。
 * 止めるのは「読み込まれない形」だけ。
 */
export function validate(kind: AuthoringKind, content: string): Problem[] {
	const range = frontmatterRange(content);
	if (!range) {
		return [{ message: '先頭に `---` で囲んだ frontmatter がありません（無いと読み込まれません）', severity: 'error', line: 0 }];
	}

	const problems: Problem[] = [];
	const lines = content.split('\n');
	const values = new Map<string, { value: string; line: number }>();
	for (const [index, line] of lines.entries()) {
		if (index === 0 || line.trim() === '---') {
			continue;
		}
		const match = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
		if (match) {
			values.set(match[1], { value: match[2].trim(), line: index });
		}
		if (line.trim() === '---' && index > 0) {
			break;
		}
	}

	for (const field of FIELDS[kind]) {
		if (!field.required) {
			continue;
		}
		const written = values.get(field.name);
		if (!written) {
			problems.push({ message: `\`${field.name}\` がありません — ${field.description}`, severity: 'error', line: 0 });
		} else if (written.value.length === 0) {
			problems.push({ message: `\`${field.name}\` が空です`, severity: 'error', line: written.line });
		}
	}

	const description = values.get('description');
	if (description && description.value.length > 0 && description.value.length < 8) {
		problems.push({
			message: 'description が短すぎます。検索に当たる場所なので、いつ使うかを具体的に書いてください',
			severity: 'warning',
			line: description.line
		});
	}

	// 本文が無いものは、読み込まれても何もしない
	if (content.slice(range.end).trim().length === 0) {
		problems.push({ message: '本文がありません（frontmatter だけでは何も起きません）', severity: 'error', line: 0 });
	}

	return problems;
}
