/**
 * サブエージェントごとのモデル指定（tasks.md T-232）。
 *
 * サブエージェントの仕事は重さがまちまちで、「ファイルを探すだけ」に一番重いモデルを
 * 使う理由はない。軽いモデルで足りるものを分けられれば、枠も費用も持つ。
 *
 * SDK の `Options.agents` は**定義そのものを渡す**形なので、モデルだけを差し替えるには
 * 元の定義（`.claude/agents/*.md`）を読み直して組み立て直す必要がある。ここはその読み取り。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface AgentFile {
	/** ファイル名（拡張子なし）か frontmatter の name */
	name: string;
	description: string;
	prompt: string;
	tools?: string[];
	model?: string;
}

/** `---` で囲まれた frontmatter を切り出す。無ければ本文だけ */
function splitFrontmatter(content: string): { front: string; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
	return match ? { front: match[1], body: match[2] } : { front: '', body: content };
}

/**
 * frontmatter を読む。YAML の完全な実装は持ち込まない
 * （必要なのは `key: value` と、カンマ区切り・角括弧のリストだけ）。
 */
function parseFrontmatter(front: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const line of front.split('\n')) {
		const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
		if (match) {
			fields[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, '');
		}
	}
	return fields;
}

function parseList(value: string | undefined): string[] | undefined {
	if (!value) {
		return undefined;
	}
	const items = value
		.replace(/^\[|\]$/g, '')
		.split(',')
		.map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
		.filter(Boolean);
	return items.length > 0 ? items : undefined;
}

/**
 * サブエージェントの定義ファイルを読む。
 * `description` と `prompt` は SDK の `AgentDefinition` で必須なので、
 * **どちらかが空なら定義として扱わない**（空のまま渡すと相手が困る）。
 */
export function parseAgentFile(fileName: string, content: string): AgentFile | undefined {
	const { front, body } = splitFrontmatter(content);
	const fields = parseFrontmatter(front);
	const name = fields['name'] || fileName.replace(/\.md$/, '');
	const prompt = body.trim();
	const description = fields['description'] || '';
	if (!name || !prompt || !description) {
		return undefined;
	}
	return {
		name,
		description,
		prompt,
		tools: parseList(fields['tools']),
		model: fields['model'] || undefined
	};
}

/** SDK の `AgentDefinition` と構造互換（必要なぶんだけ） */
export interface AgentOverride {
	description: string;
	prompt: string;
	tools?: string[];
	model?: string;
}

/**
 * モデルの割り当てを反映した `agents` を組み立てる。
 *
 * **割り当てが 1 つも無ければ空を返す** — 何も指定していないのに `agents` を渡すと、
 * 利用者の定義を Nimbus が組み直したもので置き換えることになる。
 * 触らないほうが安全なので、指定されたものだけを載せる。
 */
export function buildAgentOverrides(
	files: readonly AgentFile[],
	models: Readonly<Record<string, string>>
): Record<string, AgentOverride> {
	const overrides: Record<string, AgentOverride> = {};
	for (const file of files) {
		const model = models[file.name];
		if (!model) {
			continue;
		}
		overrides[file.name] = {
			description: file.description,
			prompt: file.prompt,
			...(file.tools ? { tools: file.tools } : {}),
			model
		};
	}
	return overrides;
}

/** 一覧に出す説明 */
export function describeAgent(file: AgentFile, assigned: string | undefined): string {
	const model = assigned ?? file.model ?? '既定';
	return `${model}${file.tools ? ` · ツール ${file.tools.length}` : ''}`;
}
