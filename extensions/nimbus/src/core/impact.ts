/**
 * 変更影響範囲の事前プレビュー（tasks.md T-158）。
 *
 * 「この変更、何を壊す？」に答えるいちばん確実な材料は、
 * **消した／名前を変えた export を、まだ誰が呼んでいるか**。
 * 型チェックが教えてくれるのは同じ言語の中だけで、しかも**直したあと**にしか出ない。
 * ここは適用の前、あるいはコミットの前に、同じことを先に見せる。
 *
 * 参照の探索は「名前で当たりをつける」までにする。厳密な解決は LSP（T-098）の仕事で、
 * ここは**LSP が立ち上がっていなくても効く**ことを優先する。
 * そのぶん誤検出があるので、**言い切らない**（「呼んでいるかもしれない」と出す）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Reference {
	path: string;
	/** 1 始まりの行番号 */
	line: number;
	text: string;
}

export interface ImpactedSymbol {
	name: string;
	kind: string;
	/** その名前を消したのか、変えたのか */
	change: 'removed' | 'changed';
	/** 変更したファイル自身を除いた参照 */
	references: Reference[];
}

/**
 * 名前が「その名前として」使われている行を探す。
 *
 * 語の切れ目で見るので `foo` は `foobar` に当たらない。
 * コメントや文字列の中も拾ってしまうが、**見落とすより出しすぎるほう**を選ぶ
 * （壊れる場所を見逃すのが一番困るので）。
 */
export function findReferences(
	files: ReadonlyMap<string, string>,
	name: string,
	exclude: ReadonlySet<string>
): Reference[] {
	if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
		return [];
	}
	const pattern = new RegExp(`\\b${name}\\b`);
	const found: Reference[] = [];
	for (const [path, content] of files) {
		if (exclude.has(path)) {
			continue;
		}
		const lines = content.split('\n');
		for (let i = 0; i < lines.length; i++) {
			if (pattern.test(lines[i])) {
				found.push({ path, line: i + 1, text: lines[i].trim().slice(0, 200) });
			}
		}
	}
	return found;
}

export interface ImpactInput {
	/** 消した／変えた export（`core/diffSummary.ts` の結果から作る） */
	symbols: { name: string; kind: string; change: 'removed' | 'changed' }[];
	/** 探索対象。パス → 中身 */
	files: ReadonlyMap<string, string>;
	/** 変更したファイル（自分自身の定義行を数えないため） */
	changedPaths: ReadonlySet<string>;
}

/** 呼び出し元が残っているものだけを返す。残っていないものは報告しない（雑音になる） */
export function assessImpact({ symbols, files, changedPaths }: ImpactInput): ImpactedSymbol[] {
	const impacted: ImpactedSymbol[] = [];
	for (const symbol of symbols) {
		const references = findReferences(files, symbol.name, changedPaths);
		if (references.length > 0) {
			impacted.push({ ...symbol, references });
		}
	}
	// 参照が多いものほど影響が大きい
	return impacted.sort((a, b) => b.references.length - a.references.length || a.name.localeCompare(b.name));
}

/** 影響を受けたファイルの数（重複を除く） */
export function affectedFileCount(impacted: readonly ImpactedSymbol[]): number {
	return new Set(impacted.flatMap((s) => s.references.map((r) => r.path))).size;
}

/** 何行まで出すか。多すぎると読まれない */
const MAX_REFERENCES = 20;

export function formatImpact(impacted: readonly ImpactedSymbol[]): string {
	if (impacted.length === 0) {
		return [
			'# 影響範囲',
			'',
			'消した・変えた export を呼んでいる箇所は見つかりませんでした。',
			'',
			'> 名前で当たりをつけているだけなので、**動的な呼び出し（文字列経由）は見えません。**',
			''
		].join('\n');
	}
	const lines = [
		'# 影響範囲',
		'',
		`消した・変えた export が ${impacted.length} 件、`
		+ `${affectedFileCount(impacted)} ファイルから呼ばれているかもしれません。`,
		'',
		'> **名前で当たりをつけているだけ**です。コメントや文字列の中も拾いますし、',
		'> 逆に動的な呼び出し（文字列経由）は見えません。**確認の出発点**として使ってください。',
		''
	];
	for (const symbol of impacted) {
		lines.push(
			`## \`${symbol.kind} ${symbol.name}\`（${symbol.change === 'removed' ? '消した' : '変えた'}）`,
			'',
			`${symbol.references.length} 箇所`,
			''
		);
		for (const reference of symbol.references.slice(0, MAX_REFERENCES)) {
			lines.push(`- \`${reference.path}:${reference.line}\` — \`${reference.text}\``);
		}
		if (symbol.references.length > MAX_REFERENCES) {
			lines.push(`- …ほか ${symbol.references.length - MAX_REFERENCES} 箇所`);
		}
		lines.push('');
	}
	return lines.join('\n');
}
