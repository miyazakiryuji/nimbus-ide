/**
 * スキーマと実物を突き合わせ、足りない API の代わりを作る
 * （tasks.md T-218 実データと型定義の突き合わせ / T-124 モックサーバー）。
 *
 * スキーマは**書いた時点の約束**でしかない。実際に返ってくるものとずれていることは普通にあり、
 * そのずれは**動かして初めて分かる**。逆に、API がまだ無い段階では、
 * スキーマから作った偽の応答があれば先へ進める。
 *
 * どちらも `core/openapi.ts` が読んだスキーマの上に乗る。
 * VS Code に依存しないので単体で検証できる。
 */
import type { SchemaModel } from './openapi';

export interface ResponseFinding {
	kind: 'missing' | 'extra' | 'type-mismatch' | 'null-not-allowed';
	field: string;
	message: string;
}

/** JSON の値から、OpenAPI の型名に寄せる */
export function typeOfValue(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	if (typeof value === 'number') {
		return Number.isInteger(value) ? 'integer' : 'number';
	}
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	if (typeof value === 'string') {
		return 'string';
	}
	return 'object';
}

/** `integer` の場所に `number` が来ても不一致にしない（JSON では区別されないことがある） */
function compatible(expected: string, actual: string): boolean {
	if (expected === actual) {
		return true;
	}
	if (expected === 'number' && actual === 'integer') {
		return true;
	}
	// `$ref` の先はここでは追わない。オブジェクトなら通す
	if (!['string', 'integer', 'number', 'boolean', 'array', 'object'].includes(expected)) {
		return actual === 'object';
	}
	return false;
}

/**
 * 実際に返ってきたものと、スキーマを突き合わせる。
 *
 * **余分なフィールドは「間違い」とは言わない。** サーバーが足しただけのことが多く、
 * 壊れているわけではない（ただし型を作り直す合図にはなる）。
 */
export function checkResponse(model: SchemaModel, response: unknown): ResponseFinding[] {
	if (typeof response !== 'object' || response === null || Array.isArray(response)) {
		return [{ kind: 'type-mismatch', field: '(全体)', message: 'オブジェクトが返るはずですが、違うものが返っています' }];
	}

	const actual = response as Record<string, unknown>;
	const findings: ResponseFinding[] = [];

	for (const field of model.fields) {
		const has = Object.prototype.hasOwnProperty.call(actual, field.name);
		if (!has) {
			if (field.required) {
				findings.push({ kind: 'missing', field: field.name, message: '必須なのに返ってきていません' });
			}
			continue;
		}
		const value = actual[field.name];
		if (value === null) {
			if (!field.nullable) {
				findings.push({ kind: 'null-not-allowed', field: field.name, message: 'null が返っていますが、スキーマでは許していません' });
			}
			continue;
		}
		const seen = typeOfValue(value);
		if (!compatible(field.type, seen)) {
			findings.push({
				kind: 'type-mismatch',
				field: field.name,
				message: `スキーマは \`${field.type}\` ですが、\`${seen}\` が返っています`
			});
		}
	}

	const known = new Set(model.fields.map((field) => field.name));
	for (const key of Object.keys(actual)) {
		if (!known.has(key)) {
			findings.push({ kind: 'extra', field: key, message: 'スキーマにありません（サーバーが足したもの／型を作り直す合図）' });
		}
	}

	return findings;
}

const EXAMPLES: Record<string, unknown> = {
	string: 'text',
	integer: 0,
	number: 0.5,
	boolean: true,
	object: {},
	unknown: null
};

/**
 * スキーマから、それらしい応答を作る（T-124）。
 *
 * **本物のように見せない。** 値は「明らかに仮のもの」にして、
 * 気づかないまま本番の判断材料にされないようにする。
 */
export function buildExample(model: SchemaModel, models: readonly SchemaModel[], depth = 0): Record<string, unknown> {
	const example: Record<string, unknown> = {};
	for (const field of model.fields) {
		if (field.type === 'array') {
			const item = field.itemType ?? 'unknown';
			example[field.name] = [EXAMPLES[item] ?? (depth < 2 ? exampleForRef(item, models, depth) : null)];
			continue;
		}
		if (field.type in EXAMPLES) {
			example[field.name] = EXAMPLES[field.type];
			continue;
		}
		example[field.name] = depth < 2 ? exampleForRef(field.type, models, depth) : null;
	}
	return example;
}

function exampleForRef(name: string, models: readonly SchemaModel[], depth: number): unknown {
	const referenced = models.find((model) => model.name === name);
	return referenced ? buildExample(referenced, models, depth + 1) : null;
}

export function renderResponseCheck(model: SchemaModel, findings: readonly ResponseFinding[]): string {
	if (findings.length === 0) {
		return `# 実物とスキーマの突き合わせ\n\n\`${model.name}\` と一致しています。\n`;
	}
	const lines = ['# 実物とスキーマの突き合わせ', '', `\`${model.name}\` と突き合わせました。`, ''];
	const order: ResponseFinding['kind'][] = ['missing', 'type-mismatch', 'null-not-allowed', 'extra'];
	const title: Record<ResponseFinding['kind'], string> = {
		missing: '返ってきていないもの',
		'type-mismatch': '型が違うもの',
		'null-not-allowed': 'null が返っているもの',
		extra: 'スキーマに無いもの'
	};
	for (const kind of order) {
		const rows = findings.filter((finding) => finding.kind === kind);
		if (rows.length === 0) {
			continue;
		}
		lines.push(`## ${title[kind]}`, '');
		for (const row of rows) {
			lines.push(`- \`${row.field}\` — ${row.message}`);
		}
		lines.push('');
	}
	return lines.join('\n');
}
