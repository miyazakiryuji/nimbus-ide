/**
 * スキーマの差分から、マイグレーションを起こす（tasks.md T-125）。
 *
 * スキーマファイルを直したあと、同じ変更を手で `ALTER TABLE` に書き直す。
 * この写経で間違えると、**本番のデータが消える**。
 *
 * ここでは差分から `ALTER TABLE` を起こし、**壊す操作を上に出す**。
 * 生成物をそのまま流すためのものではない — 見落としを減らすためのもの。
 *
 * 危なさの判定は [sqlSafety](./sqlSafety.ts) に任せる（同じ物差しで見るため）。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import { inspect, type SqlStatement } from './sqlSafety';

export interface Column {
	name: string;
	type: string;
	notNull: boolean;
	/** 既定値（あれば）。**列を足すときに要る** */
	defaultValue?: string;
}

export interface Table {
	name: string;
	columns: Column[];
}

export interface SchemaChange {
	kind: 'add-table' | 'drop-table' | 'add-column' | 'drop-column' | 'change-type';
	table: string;
	column?: string;
	/** 何が起きるかの説明（英語の DDL より、こちらを先に読む） */
	description: string;
	sql: string;
}

/**
 * `CREATE TABLE` を読む。
 *
 * SQL パーサは持ち込まない。**表と列の名前・型・NOT NULL・DEFAULT だけ**を見る。
 * 制約や索引は取りこぼす — 取りこぼしたものは差分に出ないので、
 * 「これで全部」とは言わない（呼び出し側がそう書く）。
 */
export function parseSchema(sql: string): Table[] {
	const withoutComments = sql
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.split('\n')
		.map((line) => line.replace(/--.*$/, ''))
		.join('\n');

	const tables: Table[] = [];
	const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)[`"\]]?\s*\(([\s\S]*?)\n\s*\)\s*;/gi;

	for (const match of withoutComments.matchAll(createTable)) {
		const [, name, body] = match;
		tables.push({ name, columns: parseColumns(body) });
	}
	return tables;
}

/** 表の中身を、括弧の深さを見ながら 1 列ずつに割る（`DECIMAL(10,2)` のカンマで割らないため） */
function splitColumns(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = '';
	for (const char of body) {
		if (char === '(') {
			depth++;
		} else if (char === ')') {
			depth--;
		}
		if (char === ',' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += char;
	}
	parts.push(current);
	return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

/** 列ではなく表全体の制約を書いている行 */
const TABLE_CONSTRAINT = /^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|INDEX|KEY)\b/i;

function parseColumns(body: string): Column[] {
	const columns: Column[] = [];
	for (const part of splitColumns(body)) {
		if (TABLE_CONSTRAINT.test(part)) {
			continue;
		}
		// 2 語の型（`DOUBLE PRECISION` など）は拾いたいが、`NOT NULL` の `NOT` を
		// 型として拾ってはいけない。拾うと、ありもしない型変更が「戻せない変更」に並ぶ
		const match = /^[`"[]?(\w+)[`"\]]?\s+([A-Za-z]+(?:\s*\([^)]*\))?(?:\s+(?!NOT|NULL|PRIMARY|DEFAULT|UNIQUE|REFERENCES|CHECK|GENERATED|AUTO_INCREMENT|COLLATE|AS|CONSTRAINT)[A-Za-z]+)?)/i.exec(part);
		if (!match) {
			continue;
		}
		const defaultMatch = /\bDEFAULT\s+('[^']*'|\S+)/i.exec(part);
		columns.push({
			name: match[1],
			type: match[2].replace(/\s+/g, ' ').trim().toUpperCase(),
			notNull: /\bNOT\s+NULL\b/i.test(part),
			defaultValue: defaultMatch?.[1]
		});
	}
	return columns;
}

/**
 * 前と後ろを見比べる。
 *
 * **消す側を先に見つけても、出す順は後にする**（足してから消すほうが、途中で止まったときに戻せる）。
 */
export function diffSchemas(before: readonly Table[], after: readonly Table[]): SchemaChange[] {
	const changes: SchemaChange[] = [];
	const beforeByName = new Map(before.map((table) => [table.name, table]));
	const afterByName = new Map(after.map((table) => [table.name, table]));

	for (const table of after) {
		const old = beforeByName.get(table.name);
		if (!old) {
			changes.push({
				kind: 'add-table',
				table: table.name,
				description: `表 ${table.name} を作ります`,
				sql: renderCreateTable(table)
			});
			continue;
		}
		const oldColumns = new Map(old.columns.map((column) => [column.name, column]));
		for (const column of table.columns) {
			const previous = oldColumns.get(column.name);
			if (!previous) {
				changes.push({
					kind: 'add-column',
					table: table.name,
					column: column.name,
					description: addColumnNote(table.name, column),
					sql: `ALTER TABLE ${table.name} ADD COLUMN ${renderColumn(column)};`
				});
				continue;
			}
			if (previous.type !== column.type) {
				changes.push({
					kind: 'change-type',
					table: table.name,
					column: column.name,
					description: `${table.name}.${column.name} の型が ${previous.type} から ${column.type} に変わります。**入っている値が入らなくなることがあります**`,
					sql: `ALTER TABLE ${table.name} ALTER COLUMN ${column.name} TYPE ${column.type};`
				});
			}
		}
	}

	// 消すものは後ろにまとめる
	for (const table of before) {
		const next = afterByName.get(table.name);
		if (!next) {
			changes.push({
				kind: 'drop-table',
				table: table.name,
				description: `表 ${table.name} が消えます。**中のデータは戻せません**`,
				sql: `DROP TABLE ${table.name};`
			});
			continue;
		}
		const nextColumns = new Set(next.columns.map((column) => column.name));
		for (const column of table.columns) {
			if (!nextColumns.has(column.name)) {
				changes.push({
					kind: 'drop-column',
					table: table.name,
					column: column.name,
					description: `${table.name}.${column.name} が消えます。**そこに入っていた値は戻せません**`,
					sql: `ALTER TABLE ${table.name} DROP COLUMN ${column.name};`
				});
			}
		}
	}

	return changes;
}

/**
 * 列を足すときの注意。
 *
 * **`NOT NULL` を既定値なしで足すと、既存の行があるかぎり失敗する。**
 * 手元の空のテーブルでは通り、本番で落ちる — いちばん多い落とし穴。
 */
function addColumnNote(table: string, column: Column): string {
	if (column.notNull && column.defaultValue === undefined) {
		return `${table}.${column.name} を足します。**既存の行があると失敗します**（\`NOT NULL\` なのに既定値がありません）`;
	}
	return `${table}.${column.name} を足します`;
}

function renderColumn(column: Column): string {
	const parts = [column.name, column.type];
	if (column.notNull) {
		parts.push('NOT NULL');
	}
	if (column.defaultValue !== undefined) {
		parts.push(`DEFAULT ${column.defaultValue}`);
	}
	return parts.join(' ');
}

function renderCreateTable(table: Table): string {
	const columns = table.columns.map((column) => `  ${renderColumn(column)}`).join(',\n');
	return `CREATE TABLE ${table.name} (\n${columns}\n);`;
}

/** 取り返しがつかない変更か（判定は sqlSafety に合わせる） */
export function isDestructive(change: SchemaChange): boolean {
	const statement: SqlStatement = inspect(change.sql);
	return statement.destructive || change.kind === 'change-type';
}

/** 流す順。**足す・変えるが先、消すのは最後** */
export function orderChanges(changes: readonly SchemaChange[]): SchemaChange[] {
	const weight: Record<SchemaChange['kind'], number> = {
		'add-table': 0,
		'add-column': 1,
		'change-type': 2,
		'drop-column': 3,
		'drop-table': 4
	};
	return [...changes].sort((a, b) => weight[a.kind] - weight[b.kind]);
}

export function renderMigration(changes: readonly SchemaChange[]): string {
	if (changes.length === 0) {
		return '# マイグレーション\n\nスキーマに差はありませんでした。\n';
	}

	const ordered = orderChanges(changes);
	const destructive = ordered.filter(isDestructive);
	const lines = ['# マイグレーション', '', `${changes.length} 件の差分があります。`, ''];

	if (destructive.length > 0) {
		lines.push(`## 先に読む — 戻せない変更（${destructive.length}）`, '');
		for (const change of destructive) {
			lines.push(`- ${change.description}`);
		}
		lines.push('', '**流す前にバックアップを取ってください。** 消した列は、バックアップからしか戻せません。', '');
	}

	lines.push('## 手順', '', '足すものが先、消すものが最後です（途中で止めても戻せるように）。', '', '```sql');
	for (const change of ordered) {
		lines.push(`-- ${change.description}`);
		lines.push(change.sql);
	}
	lines.push('```', '');
	lines.push(
		'**これで全部とは限りません。** 索引・制約・トリガーは見ていないので、',
		'スキーマの差分と見比べてから流してください。',
		''
	);
	return lines.join('\n');
}
