/**
 * MCP ツールの引数を、スキーマから聞き出す（tasks.md T-235）。
 *
 * ツールを 1 回だけ試したいのに、そのたびエージェントに頼むのは遠回りで、
 * しかも**エージェントが引数を間違えたのか、ツールが壊れているのか**が分からない。
 * 引数を自分で入れて直接呼べれば、切り分けが一発で済む。
 *
 * ここは「JSON Schema を、聞くべき項目の並びに直す」ところだけ。
 * VS Code にも MCP SDK にも依存しないので単体で検証できる。
 */

/** 受け取る側は JSON Schema の一部しか使わない */
export interface JsonSchema {
	type?: string;
	properties?: Record<string, JsonSchema>;
	required?: string[];
	description?: string;
	enum?: unknown[];
	default?: unknown;
	items?: JsonSchema;
}

export interface ArgField {
	name: string;
	/** 入力欄の見出しに出す型（`string` / `number` / …） */
	type: string;
	description?: string;
	required: boolean;
	/** 選択肢があるなら、入力欄ではなく選択にする */
	choices?: string[];
	/** 既定値（そのまま入力欄に入れておく） */
	placeholder?: string;
}

/**
 * スキーマを、聞くべき項目の並びにする。
 * **必須を先に出す。** 任意の項目から聞くと、必須に辿り着く前に諦められる。
 */
export function toFields(schema: JsonSchema | undefined): ArgField[] {
	const properties = schema?.properties;
	if (!properties) {
		return [];
	}
	const required = new Set(schema?.required ?? []);
	const fields: ArgField[] = Object.entries(properties).map(([name, property]) => ({
		name,
		type: property.type ?? 'string',
		description: property.description,
		required: required.has(name),
		choices: property.enum?.map((value) => String(value)),
		placeholder: property.default === undefined ? undefined : String(property.default)
	}));
	// 必須が先。同じ区分の中では元の順を保つ（スキーマの並びには意味があることが多い）
	return [...fields.filter((f) => f.required), ...fields.filter((f) => !f.required)];
}

export type Coerced = { ok: true; value: unknown } | { ok: false; reason: string };

/**
 * 入力欄の文字列を、スキーマの型へ直す。
 *
 * **文字列のまま渡さない** — MCP サーバー側は型で弾くので、
 * `"3"` と `3` の違いで「動かない」と言われることになる。
 */
export function coerce(type: string, raw: string): Coerced {
	const text = raw.trim();
	switch (type) {
		case 'number':
		case 'integer': {
			if (text === '') {
				return { ok: false, reason: '数を入れてください' };
			}
			const value = Number(text);
			if (!Number.isFinite(value)) {
				return { ok: false, reason: `数として読めません: ${text}` };
			}
			if (type === 'integer' && !Number.isInteger(value)) {
				return { ok: false, reason: `整数を入れてください: ${text}` };
			}
			return { ok: true, value };
		}
		case 'boolean': {
			if (/^(true|yes|はい|1)$/i.test(text)) {
				return { ok: true, value: true };
			}
			if (/^(false|no|いいえ|0)$/i.test(text)) {
				return { ok: true, value: false };
			}
			return { ok: false, reason: `true か false で入れてください: ${text}` };
		}
		case 'object':
		case 'array': {
			try {
				const value: unknown = JSON.parse(text);
				const isArray = Array.isArray(value);
				if (type === 'array' && !isArray) {
					return { ok: false, reason: '配列（`[...]`）を入れてください' };
				}
				if (type === 'object' && (isArray || value === null || typeof value !== 'object')) {
					return { ok: false, reason: 'オブジェクト（`{...}`）を入れてください' };
				}
				return { ok: true, value };
			} catch {
				return { ok: false, reason: 'JSON として読めません' };
			}
		}
		default:
			return { ok: true, value: raw };
	}
}

export type BuildResult =
	| { ok: true; args: Record<string, unknown> }
	| { ok: false; reason: string };

/**
 * 入力を引数にまとめる。
 * **空のまま飛ばした任意項目は入れない** — `undefined` を渡すのと、
 * キーごと無いのとで振る舞いが変わるサーバーがある。
 */
export function buildArgs(fields: readonly ArgField[], entered: ReadonlyMap<string, string>): BuildResult {
	const args: Record<string, unknown> = {};
	for (const field of fields) {
		const raw = entered.get(field.name);
		if (raw === undefined || raw.trim() === '') {
			if (field.required) {
				return { ok: false, reason: `${field.name} は必須です` };
			}
			continue;
		}
		const coerced = coerce(field.type, raw);
		if (!coerced.ok) {
			return { ok: false, reason: `${field.name}: ${coerced.reason}` };
		}
		args[field.name] = coerced.value;
	}
	return { ok: true, args };
}

/**
 * MCP の結果から、読める文だけ取り出す。
 *
 * `toolResult` は**古い形**（`content` を持たないサーバーがこちらで返す）。
 * 受けないと、そういうサーバーで「何も出ない」ことになる。
 */
export interface ToolCallResult {
	isError?: boolean;
	content?: { type: string; text?: string }[];
	structuredContent?: unknown;
	toolResult?: unknown;
}

/**
 * 結果を人が読める形にする。
 * **失敗も同じ経路で見せる** — 「何も出ない」が一番困る。
 */
export function describeResult(result: ToolCallResult, elapsedMs: number): string {
	const lines: string[] = [];
	lines.push(result.isError ? `失敗しました（${elapsedMs} ms）` : `成功しました（${elapsedMs} ms）`);
	lines.push('');
	const texts = (result.content ?? [])
		.map((part) => (part.type === 'text' ? part.text ?? '' : `（${part.type}）`))
		.filter((text) => text.length > 0);
	if (texts.length > 0) {
		lines.push(...texts);
	} else if (result.structuredContent !== undefined) {
		lines.push(JSON.stringify(result.structuredContent, null, 2));
	} else if (result.toolResult !== undefined) {
		lines.push(JSON.stringify(result.toolResult, null, 2));
	} else {
		lines.push('（中身が空でした）');
	}
	return lines.join('\n');
}
