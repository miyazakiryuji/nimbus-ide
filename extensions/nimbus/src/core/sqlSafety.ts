/**
 * SQL を流す前に見る（tasks.md T-126 読み取りだけモード / T-127 実行計画）。
 *
 * エージェントが書いた SQL は、**構文が合っていれば流れてしまう**。
 * `WHERE` を忘れた `UPDATE` は正しい SQL で、正しく全行を書き換える。
 *
 * ここで見るのは「取り返しがつくかどうか」だけ。**速いかどうかは実行計画に任せる**
 * （静的には分からないので、代わりに `EXPLAIN` の打ち方を出す）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type StatementKind = 'read' | 'write' | 'schema' | 'unknown';

export interface SqlStatement {
	text: string;
	kind: StatementKind;
	/** 取り返しがつかない操作か */
	destructive: boolean;
	/** 気をつける点 */
	warnings: string[];
}

const READ = /^\s*(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE)\b/i;
const WRITE = /^\s*(INSERT|UPDATE|DELETE|MERGE|UPSERT|REPLACE)\b/i;
const SCHEMA = /^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME|GRANT|REVOKE)\b/i;

/** コメントと空行を落として、文ごとに割る */
export function splitStatements(sql: string): string[] {
	const withoutComments = sql
		.replace(/\/\*[\s\S]*?\*\//g, ' ')
		.split('\n')
		.map((line) => line.replace(/--.*$/, ''))
		.join('\n');
	return withoutComments
		.split(';')
		.map((statement) => statement.trim())
		.filter((statement) => statement.length > 0);
}

export function classify(statement: string): StatementKind {
	if (READ.test(statement)) {
		return 'read';
	}
	if (WRITE.test(statement)) {
		return 'write';
	}
	if (SCHEMA.test(statement)) {
		return 'schema';
	}
	return 'unknown';
}

/**
 * 1 文を見る。
 *
 * **「危ない」ではなく「何が起きるか」を書く。** `WHERE` の無い `DELETE` は
 * 「危険」ではなく「全行が消えます」と言ったほうが、手が止まる。
 */
export function inspect(statement: string): SqlStatement {
	const kind = classify(statement);
	const warnings: string[] = [];
	let destructive = false;

	if (/^\s*(DELETE|UPDATE)\b/i.test(statement) && !/\bWHERE\b/i.test(statement)) {
		warnings.push(/^\s*DELETE/i.test(statement) ? '`WHERE` がありません — **全行が消えます**' : '`WHERE` がありません — **全行が書き換わります**');
		destructive = true;
	}
	if (/^\s*DROP\b/i.test(statement)) {
		warnings.push('**テーブルごと消えます**（`DROP`）。戻せるのはバックアップからだけです');
		destructive = true;
	}
	if (/^\s*TRUNCATE\b/i.test(statement)) {
		warnings.push('**中身が全部消えます**（`TRUNCATE`）。多くの DB でロールバックできません');
		destructive = true;
	}
	if (/\bALTER\s+TABLE\b[\s\S]*\bDROP\s+COLUMN\b/i.test(statement)) {
		warnings.push('**列ごと消えます**。そこに入っていたデータは戻せません');
		destructive = true;
	}
	if (kind === 'write' && /\bSELECT\b[\s\S]*\bFROM\b/i.test(statement) && /^\s*INSERT/i.test(statement)) {
		warnings.push('別のテーブルから読んで書き込みます。読み側の件数を先に数えてください');
	}

	return { text: statement, kind, destructive, warnings };
}

/** 読み取りだけか（そのまま流してよいか） */
export function isReadOnly(statements: readonly SqlStatement[]): boolean {
	return statements.length > 0 && statements.every((statement) => statement.kind === 'read');
}

/** 実行計画の打ち方。DB によって書き方が違うので、両方出す */
export function explainFor(statement: string): string[] {
	const trimmed = statement.trim();
	return [`EXPLAIN ${trimmed}`, `EXPLAIN ANALYZE ${trimmed}`];
}

export function renderSqlReport(statements: readonly SqlStatement[]): string {
	if (statements.length === 0) {
		return '# SQL の確認\n\n文が見つかりませんでした。\n';
	}

	const destructive = statements.filter((statement) => statement.destructive);
	const lines = ['# SQL の確認', '', `${statements.length} 文。`, ''];

	if (isReadOnly(statements)) {
		lines.push('**読み取りだけです。** そのまま流して問題ありません。', '');
		lines.push('遅いかどうかは静的には分かりません。気になるときは実行計画を見てください:', '');
		lines.push('```sql', ...explainFor(statements[0].text), '```', '');
		return lines.join('\n');
	}

	if (destructive.length > 0) {
		lines.push(`## 取り返しがつかないもの（${destructive.length}）`, '');
		for (const statement of destructive) {
			lines.push(`- \`${statement.text.slice(0, 80)}\``);
			for (const warning of statement.warnings) {
				lines.push(`  - ${warning}`);
			}
		}
		lines.push('', '**流す前に、対象の件数を `SELECT COUNT(*)` で数えてください。**', '');
	}

	const writes = statements.filter((statement) => statement.kind === 'write' && !statement.destructive);
	if (writes.length > 0) {
		lines.push(`## 書き込み（${writes.length}）`, '');
		for (const statement of writes) {
			lines.push(`- \`${statement.text.slice(0, 80)}\``);
			for (const warning of statement.warnings) {
				lines.push(`  - ${warning}`);
			}
		}
		lines.push('');
	}

	lines.push('遅いかどうかは静的には分かりません。実行計画で見てください。', '');
	return lines.join('\n');
}
