/**
 * どこからも使われていない export を見つける（tasks.md T-112）。
 *
 * 使われていないコードは、読む人の時間を奪い、エージェントには「使ってよい API」に見える。
 * **消すのは人が決める**ので、ここは候補を挙げるところまで。
 *
 * 構文解析はしない（言語ごとにパーサを持つと保守できない）。import 側の名前と
 * export 側の名前を突き合わせるだけ。取りこぼす（＝挙げない）方向に倒す —
 * 使われているものを「死んでいる」と言うほうが害が大きい。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface DeadExport {
	file: string;
	name: string;
	kind: string;
	/**
	 * `local-only` = 自分のファイルの中では使っている（`export` を外せる）
	 * `dead` = どこでも使われていない
	 * 分けないと、外し忘れの `export` に本当の死骸が埋もれる。
	 */
	reason: 'dead' | 'local-only';
}

/** `export function foo` `export const bar` `export class Baz` などの宣言 */
const EXPORT_DECLARATION = /^\s*export\s+(?:async\s+)?(function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;

/** `export { a, b as c }` の並び */
const EXPORT_LIST = /^\s*export\s*\{([^}]*)\}/gm;

/** `import { a, b as c } from '...'` の並び */
const IMPORT_LIST = /import\s+(?:type\s+)?\{([^}]*)\}\s*from/g;

/** `import foo from '...'` / `import * as foo from '...'` */
const IMPORT_DEFAULT = /import\s+(?:type\s+)?(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s*from/g;

function namesIn(list: string): string[] {
	return list
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		// `import { type Skill }` のインライン修飾子を外す。このリポジトリの主流の書き方なので、
		// 見落とすと型の import がすべて「使われていない」に化ける（実データで 136 件出た）
		.map((part) => part.replace(/^(?:type|typeof)\s+/, ''))
		// `a as b` は、使う側では b、定義側では a。両方拾っておく
		.flatMap((part) => part.split(/\s+as\s+/).map((name) => name.trim()))
		.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/** そのファイルが公開している名前 */
export function collectExports(content: string): { name: string; kind: string }[] {
	const found: { name: string; kind: string }[] = [];
	for (const match of content.matchAll(EXPORT_DECLARATION)) {
		found.push({ kind: match[1], name: match[2] });
	}
	for (const match of content.matchAll(EXPORT_LIST)) {
		for (const name of namesIn(match[1])) {
			found.push({ kind: 'export', name });
		}
	}
	return found;
}

/** そのファイルが取り込んでいる名前 */
export function collectImports(content: string): string[] {
	const names: string[] = [];
	for (const match of content.matchAll(IMPORT_LIST)) {
		names.push(...namesIn(match[1]));
	}
	for (const match of content.matchAll(IMPORT_DEFAULT)) {
		names.push(match[1]);
	}
	return names;
}

/**
 * 入口として扱うファイル。ここの export は外（VS Code・テスト実行）から呼ばれるので、
 * import が無くても死んでいない。
 */
function isEntryPoint(path: string): boolean {
	return /(^|\/)(extension|main|index)\.[cm]?tsx?$/.test(path) || /\.(test|spec)\.[cm]?tsx?$/.test(path);
}

/**
 * どこからも import されていない export を挙げる。
 *
 * **名前だけで突き合わせる。** 同じ名前が別のファイルで使われていたら「使われている」と見なす
 * （誤って「死んでいる」と言わないため）。
 */
export function findDeadExports(files: readonly { path: string; content: string }[]): DeadExport[] {
	const imported = new Set<string>();
	for (const file of files) {
		for (const name of collectImports(file.content)) {
			imported.add(name);
		}
	}

	const dead: DeadExport[] = [];
	for (const file of files) {
		if (isEntryPoint(file.path)) {
			continue;
		}
		for (const exported of collectExports(file.content)) {
			if (imported.has(exported.name)) {
				continue;
			}
			// 宣言そのもの以外にその名前が出てくるなら、そのファイルの中では使っている
			const occurrences = file.content.split(new RegExp(`\\b${exported.name}\\b`)).length - 1;
			dead.push({
				file: file.path,
				name: exported.name,
				kind: exported.kind,
				reason: occurrences > 1 ? 'local-only' : 'dead'
			});
		}
	}
	return dead.sort(
		(a, b) =>
			Number(a.reason === 'local-only') - Number(b.reason === 'local-only') ||
			a.file.localeCompare(b.file) ||
			a.name.localeCompare(b.name)
	);
}

/** 読める形にする */
export function renderDeadExports(dead: readonly DeadExport[]): string {
	if (dead.length === 0) {
		return '';
	}
	const truly = dead.filter((item) => item.reason === 'dead');
	const localOnly = dead.filter((item) => item.reason === 'local-only');
	const lines = ['## 使われていない export', ''];

	if (truly.length > 0) {
		lines.push(`**どこでも使われていないもの: ${truly.length} 件。** 消すかどうかは人が決めてください（外部から使う予定かもしれません）。`, '');
		for (const item of truly.slice(0, 20)) {
			lines.push(`- \`${item.file}\` の \`${item.name}\`（${item.kind}）`);
		}
		if (truly.length > 20) {
			lines.push(`- …ほか ${truly.length - 20} 件`);
		}
		lines.push('');
	}

	if (localOnly.length > 0) {
		lines.push(
			`**自分のファイルの中でしか使っていないもの: ${localOnly.length} 件。** 死んではいませんが、`,
			'`export` を外せます（「必要になるまで公開しない」— コーディング規約）。',
			''
		);
		for (const item of localOnly.slice(0, 10)) {
			lines.push(`- \`${item.file}\` の \`${item.name}\`（${item.kind}）`);
		}
		if (localOnly.length > 10) {
			lines.push(`- …ほか ${localOnly.length - 10} 件`);
		}
	}
	lines.push('');
	return lines.join('\n');
}
