/**
 * 差分のセマンティック要約（tasks.md T-157）。
 *
 * 「何を意図した変更か」は機械には分からない。分かるのは**何がどう変わったか**の構造
 * — どの関数が増えて、どの export が消えて、どのファイルが実装でどれがテストか。
 * それを先に読めれば、差分そのものを読む速さが変わる。
 *
 * ここは**構造だけ**を出す。意図の要約は Claude に渡す（そのための下敷きになる）。
 * 「+120 −40」だけでは何も分からないが、「`export function foo` が増えた」なら分かる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

import { isGenerated, summarizeGenerated } from './generated';

/** ファイルの役どころ。読む順番を決めるのに使う */
export type FileRole = 'implementation' | 'test' | 'spec' | 'config' | 'core' | 'other';

export interface SymbolChange {
	/** `function` / `class` / `interface` / `const` など */
	kind: string;
	name: string;
	change: 'added' | 'removed';
	/** export されているか。API の増減はここで見る */
	exported: boolean;
}

export interface FileSummary {
	path: string;
	role: FileRole;
	added: number;
	removed: number;
	symbols: SymbolChange[];
	/** 新しく作られたファイルか */
	isNew: boolean;
	/** 消されたファイルか */
	isDeleted: boolean;
	/** 生成物か（T-140）。差分では畳んで、件数だけ見せる */
	generated: boolean;
}

const ROLE_LABEL: Record<FileRole, string> = {
	implementation: '実装',
	test: 'テスト',
	spec: '仕様・記録',
	config: '設定',
	core: 'コア（src/vs）',
	other: 'その他'
};

export function roleOf(path: string): FileRole {
	if (/^src\/vs\//.test(path)) {
		return 'core';
	}
	if (/(^|\/)(test|tests|__tests__)\/|\.test\.[jt]sx?$|\.spec\.[jt]sx?$/.test(path)) {
		return 'test';
	}
	if (/\.(md|txt)$/.test(path)) {
		return 'spec';
	}
	if (/(^|\/)(package\.json|tsconfig[^/]*\.json|.*\.ya?ml|.*\.config\.[jt]s)$/.test(path)) {
		return 'config';
	}
	if (/\.[jt]sx?$|\.dart$|\.go$|\.py$|\.rs$|\.swift$|\.kt$/.test(path)) {
		return 'implementation';
	}
	return 'other';
}

/**
 * 宣言らしい行を読む。完全なパーサではないので、**確実に読めるものだけ**を採る。
 * 曖昧なものを混ぜると、要約そのものが信用されなくなる。
 *
 * **字下げのある行は採らない。** 関数の中の `const local = 1;` まで拾うと、
 * 要約が局所変数で埋まって見取り図の役に立たなくなる（実装して気づいた）。
 * 見取り図として意味があるのは、ファイルの最上位にある宣言だけ。
 */
const DECLARATION =
	/^(?:(export)\s+)?(?:default\s+)?(?:async\s+)?(function|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/;

function declarationOf(line: string): { kind: string; name: string; exported: boolean } | undefined {
	const match = DECLARATION.exec(line);
	if (!match) {
		return undefined;
	}
	return { kind: match[2], name: match[3], exported: Boolean(match[1]) };
}

/**
 * `git diff` の出力を読む。
 * ファイルごとに増減の行数と、増えた／消えた宣言を集める。
 */
export function summarizeDiff(diff: string): FileSummary[] {
	const files: FileSummary[] = [];
	let current: FileSummary | undefined;
	/** 同じ名前が消えて足された（＝中身の変更）は打ち消すため、いったん貯める */
	let added: SymbolChange[] = [];
	let removed: SymbolChange[] = [];
	/** 足された行の冒頭。生成物の印を探すのに使う（全文は要らない） */
	let addedHead: string[] = [];

	const flush = (): void => {
		if (!current) {
			return;
		}
		// 名前で決まらないときは、足された行の冒頭に「生成物」の印が無いかを見る
		current.generated = isGenerated(current.path, addedHead.join('\n'));
		// 消えて足されたものは「変更」なので、増減としては出さない
		const removedNames = new Set(removed.map((s) => `${s.kind}:${s.name}`));
		const addedNames = new Set(added.map((s) => `${s.kind}:${s.name}`));
		current.symbols = [
			...added.filter((s) => !removedNames.has(`${s.kind}:${s.name}`)),
			...removed.filter((s) => !addedNames.has(`${s.kind}:${s.name}`))
		];
		files.push(current);
		added = [];
		removed = [];
		addedHead = [];
	};

	for (const line of diff.split('\n')) {
		const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
		if (header) {
			flush();
			current = {
				path: header[2],
				role: roleOf(header[2]),
				added: 0,
				removed: 0,
				symbols: [],
				isNew: false,
				isDeleted: false,
				// 中身は flush のときに見る（この時点ではまだ 1 行も読んでいない）
				generated: false
			};
			continue;
		}
		if (!current) {
			continue;
		}
		if (line.startsWith('new file mode')) {
			current.isNew = true;
			continue;
		}
		if (line.startsWith('deleted file mode')) {
			current.isDeleted = true;
			continue;
		}
		// `+++` / `---` はヘッダなので数に入れない
		if (/^(\+\+\+|---) /.test(line)) {
			continue;
		}
		if (line.startsWith('+')) {
			current.added++;
			if (addedHead.length < 5) {
				addedHead.push(line.slice(1));
			}
			const declaration = declarationOf(line.slice(1));
			if (declaration) {
				added.push({ ...declaration, change: 'added' });
			}
		} else if (line.startsWith('-')) {
			current.removed++;
			const declaration = declarationOf(line.slice(1));
			if (declaration) {
				removed.push({ ...declaration, change: 'removed' });
			}
		}
	}
	flush();
	return files;
}

/** 読む順番。実装 → テスト → 設定 → コア → 仕様 → その他 */
const ROLE_ORDER: FileRole[] = ['implementation', 'test', 'config', 'core', 'spec', 'other'];

export function sortSummaries(files: readonly FileSummary[]): FileSummary[] {
	return [...files].sort(
		(a, b) =>
			ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
			b.added + b.removed - (a.added + a.removed) ||
			a.path.localeCompare(b.path)
	);
}

/** export の増減だけを抜き出す。API が変わったかはここだけ見れば分かる */
export function apiChanges(files: readonly FileSummary[]): SymbolChange[] {
	return files.flatMap((file) => file.symbols.filter((symbol) => symbol.exported));
}

/** 人が最初に読む一枚 */
export function formatSummary(files: readonly FileSummary[]): string {
	if (files.length === 0) {
		return '# 変更の要約\n\n変更はありません。\n';
	}
	const all = sortSummaries(files);
	// 生成物は畳む（T-140）。手書きと同じ重みで並ぶと、読むべき数行が埋もれる
	const sorted = all.filter((file) => !file.generated);
	const generated = all.filter((file) => file.generated);
	const added = all.reduce((sum, f) => sum + f.added, 0);
	const removed = all.reduce((sum, f) => sum + f.removed, 0);
	const api = apiChanges(sorted);

	const lines = [
		'# 変更の要約',
		'',
		`${files.length} ファイル・+${added} −${removed}`,
		'',
		'> 「何がどう変わったか」を構造で出したもの。**意図までは機械には分からない** —',
		'> 差分を読む前の見取り図として使う。',
		''
	];

	if (api.length > 0) {
		lines.push('## 外から見える変化（export）', '');
		for (const symbol of api) {
			lines.push(`- ${symbol.change === 'added' ? '足した' : '消した'} \`${symbol.kind} ${symbol.name}\``);
		}
		lines.push('', '消した export があるときは、呼び出し元が残っていないかを先に見る。', '');
	}

	let role: FileRole | undefined;
	for (const file of sorted) {
		if (file.role !== role) {
			role = file.role;
			lines.push(`## ${ROLE_LABEL[role]}`, '');
		}
		const mark = file.isNew ? '（新規）' : file.isDeleted ? '（削除）' : '';
		lines.push(`### \`${file.path}\`${mark}`, '', `+${file.added} −${file.removed}`, '');
		if (file.symbols.length > 0) {
			for (const symbol of file.symbols) {
				lines.push(
					`- ${symbol.change === 'added' ? '足した' : '消した'} ${symbol.exported ? '**export** ' : ''}\`${symbol.kind} ${symbol.name}\``
				);
			}
			lines.push('');
		}
	}

	// 畳んでも**隠さない**。件数と行数は必ず見せ、名前も並べる。
	// 生成物が「動いていないこと」に気づきたい場面があるため
	if (generated.length > 0) {
		lines.push('## 生成物', '', summarizeGenerated(generated), '');
		for (const file of generated) {
			lines.push(`- \`${file.path}\` +${file.added} −${file.removed}`);
		}
		lines.push('');
	}
	return lines.join('\n');
}

/** Claude に「意図」を要約させるための頼みかた */
export function intentPrompt(files: readonly FileSummary[]): string {
	return [
		'いまの作業ツリーの変更について、**何を意図した変更か**を先に読める形でまとめてください。',
		'',
		'- 変更のかたまりごとに「何のために」を 1 行で',
		'- 外から見える振る舞いが変わるものがあれば、それを最初に',
		'- 意図が読み取れないものは「読み取れない」と書いてください（推測で埋めない）',
		'',
		'構造としては次のようになっています。',
		'',
		formatSummary(files)
	].join('\n');
}
