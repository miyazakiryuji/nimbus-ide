/**
 * OpenAPI のスキーマから型を起こす（tasks.md T-122）。
 *
 * 手で書くと必ずずれる。**「存在しないフィールドを叩く」事故はここから生まれる**ので、
 * スキーマがあるなら、そこから型を作ってしまうのがいちばん確実。
 *
 * 対応するのは `components.schemas` のオブジェクトだけ。込み入ったもの（`oneOf` /
 * `allOf` / 再帰）は**扱わないと明言する**（半端に出すと、間違った型を信じさせる）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface SchemaField {
	name: string;
	/** OpenAPI 上の型（`string` / `integer` / `$ref` の名前など） */
	type: string;
	required: boolean;
	nullable: boolean;
	/** 配列なら要素の型 */
	itemType?: string;
}

export interface SchemaModel {
	name: string;
	fields: SchemaField[];
	/** 扱えなかった理由（あるときだけ） */
	unsupported?: string;
}

type RawSchema = {
	type?: string;
	properties?: Record<string, RawSchema>;
	required?: string[];
	nullable?: boolean;
	items?: RawSchema;
	$ref?: string;
	oneOf?: unknown[];
	allOf?: unknown[];
	anyOf?: unknown[];
};

function refName(ref: string): string {
	return ref.split('/').pop() ?? ref;
}

function typeOf(schema: RawSchema): { type: string; itemType?: string } {
	if (schema.$ref) {
		return { type: refName(schema.$ref) };
	}
	if (schema.type === 'array') {
		const item = schema.items ? typeOf(schema.items) : { type: 'unknown' };
		return { type: 'array', itemType: item.type };
	}
	return { type: schema.type ?? 'unknown' };
}

/** `components.schemas` を読む。JSON でも YAML から起こした object でも同じ形を受ける */
export function parseSchemas(document: unknown): SchemaModel[] {
	const schemas = (document as { components?: { schemas?: Record<string, RawSchema> } })?.components?.schemas;
	if (!schemas) {
		return [];
	}

	const models: SchemaModel[] = [];
	for (const [name, schema] of Object.entries(schemas)) {
		if (schema.oneOf || schema.allOf || schema.anyOf) {
			models.push({ name, fields: [], unsupported: 'oneOf / allOf / anyOf は扱いません（手で書いてください）' });
			continue;
		}
		if (schema.type !== 'object' || !schema.properties) {
			models.push({ name, fields: [], unsupported: 'オブジェクト以外は扱いません' });
			continue;
		}
		const required = new Set(schema.required ?? []);
		const fields = Object.entries(schema.properties).map(([field, property]): SchemaField => {
			const { type, itemType } = typeOf(property);
			return {
				name: field,
				type,
				itemType,
				required: required.has(field),
				nullable: property.nullable === true
			};
		});
		models.push({ name, fields });
	}
	return models;
}

const DART_TYPES: Record<string, string> = {
	string: 'String',
	integer: 'int',
	number: 'double',
	boolean: 'bool',
	object: 'Map<String, dynamic>',
	unknown: 'dynamic'
};

function dartType(field: SchemaField): string {
	const base =
		field.type === 'array'
			? `List<${DART_TYPES[field.itemType ?? 'unknown'] ?? field.itemType ?? 'dynamic'}>`
			: DART_TYPES[field.type] ?? field.type;
	// 必須でない、または nullable なら `?` を付ける。**曖昧なら nullable に倒す**
	return field.required && !field.nullable ? base : `${base}?`;
}

/** Dart のモデルを起こす（`fromJson` つき） */
export function toDart(model: SchemaModel): string {
	if (model.unsupported) {
		return `// ${model.name}: ${model.unsupported}`;
	}
	const lines = [`class ${model.name} {`];
	for (const field of model.fields) {
		lines.push(`  final ${dartType(field)} ${field.name};`);
	}
	lines.push('');
	lines.push(`  const ${model.name}({`);
	for (const field of model.fields) {
		lines.push(`    ${field.required && !field.nullable ? 'required ' : ''}this.${field.name},`);
	}
	lines.push('  });');
	lines.push('');
	lines.push(`  factory ${model.name}.fromJson(Map<String, dynamic> json) => ${model.name}(`);
	for (const field of model.fields) {
		lines.push(`    ${field.name}: json['${field.name}'] as ${dartType(field)},`);
	}
	lines.push('  );');
	lines.push('}');
	return lines.join('\n');
}

const TS_TYPES: Record<string, string> = {
	string: 'string',
	integer: 'number',
	number: 'number',
	boolean: 'boolean',
	object: 'Record<string, unknown>',
	unknown: 'unknown'
};

/** TypeScript の型を起こす */
export function toTypeScript(model: SchemaModel): string {
	if (model.unsupported) {
		return `// ${model.name}: ${model.unsupported}`;
	}
	const lines = [`export interface ${model.name} {`];
	for (const field of model.fields) {
		const base =
			field.type === 'array'
				? `${TS_TYPES[field.itemType ?? 'unknown'] ?? field.itemType}[]`
				: TS_TYPES[field.type] ?? field.type;
		lines.push(`\t${field.name}${field.required ? '' : '?'}: ${base}${field.nullable ? ' | null' : ''};`);
	}
	lines.push('}');
	return lines.join('\n');
}

export function renderModels(models: readonly SchemaModel[], language: 'dart' | 'typescript'): string {
	if (models.length === 0) {
		return '# スキーマから型を起こす\n\n`components.schemas` が見つかりませんでした。\n';
	}
	const render = language === 'dart' ? toDart : toTypeScript;
	const fence = language === 'dart' ? 'dart' : 'typescript';
	const lines = [
		'# スキーマから型を起こす',
		'',
		`${models.length} 個の定義から起こしました。**そのまま貼らずに、命名と null の扱いを確かめてください。**`,
		''
	];
	for (const model of models) {
		lines.push(`## ${model.name}`, '', '```' + fence, render(model), '```', '');
	}
	return lines.join('\n');
}
