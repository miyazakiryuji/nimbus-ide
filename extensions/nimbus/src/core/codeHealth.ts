/**
 * 命名のゆれと、そっくりな実装を見つける（tasks.md T-178 / T-137）。
 *
 * どちらも「間違ってはいないが、増えると効いてくる」たぐいのもの。人は気づけないし、
 * エージェントは**周りに揃えるのが得意なので、ゆれた状態を見せると増やしてしまう**。
 *
 * 判定は保守的にする。誤って指摘すると、その指摘自体が読まれなくなる。
 * VS Code に依存しないので単体で検証できる。
 */

export interface NamingIssue {
	/** 揺れている概念（正規化した語） */
	concept: string;
	/** 実際に使われている綴り（多い順） */
	variants: { name: string; count: number }[];
}

export interface DuplicateBlock {
	/** そっくりな中身（正規化前の最初の 1 つ） */
	sample: string;
	/** 見つかった場所 */
	places: { file: string; line: number }[];
}

/** 識別子を語に割る（`fooBar` / `foo_bar` / `FooBar` → `foo` `bar`） */
export function splitIdentifier(name: string): string[] {
	return name
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/[_-]+/g, ' ')
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

/** 全部大文字（`MAX_SIZE`）は定数の綴り。変数とは別の慣習なので、混ぜて比べない */
function isConstantCase(name: string): boolean {
	return /^[A-Z][A-Z0-9_]*$/.test(name);
}

/**
 * 語の並びを鍵にする。`getUserName` と `get_user_name` は同じ概念。
 * ただし定数（`EDIT`）と変数（`edit`）は**別の慣習**なので、鍵を分ける
 * （分けないと `PNG` と `png` のような正しい組が延々と挙がって、指摘が読まれなくなる）。
 */
export function conceptKey(name: string): string {
	const key = splitIdentifier(name).join('.');
	return isConstantCase(name) ? `const:${key}` : key;
}

/**
 * 同じ概念に別の綴りが使われている箇所を見つける。
 *
 * **綴りが 2 通り以上あるものだけ**を出す。1 通りしか無いものは、それが規約。
 */
export function findNamingIssues(names: readonly string[], threshold = 2): NamingIssue[] {
	const byConcept = new Map<string, Map<string, number>>();
	for (const name of names) {
		if (name.length < 3) {
			continue;
		}
		const key = conceptKey(name);
		const variants = byConcept.get(key) ?? new Map<string, number>();
		variants.set(name, (variants.get(name) ?? 0) + 1);
		byConcept.set(key, variants);
	}

	const issues: NamingIssue[] = [];
	for (const [concept, variants] of byConcept) {
		if (variants.size < threshold) {
			continue;
		}
		issues.push({
			concept,
			variants: [...variants.entries()]
				.map(([name, count]) => ({ name, count }))
				.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
		});
	}
	return issues.sort((a, b) => b.variants.length - a.variants.length || a.concept.localeCompare(b.concept));
}

/** 比較のための正規化。空白と行末の記号だけを落とす（意味には踏み込まない） */
function normalizeLine(line: string): string {
	return line.replace(/\s+/g, ' ').trim();
}

/** 数えるに値しない行（閉じ括弧だけ、コメント、短すぎるもの） */
function isNoise(line: string): boolean {
	const text = normalizeLine(line);
	return (
		text.length < 20 ||
		/^[)\]};,]+$/.test(text) ||
		/^(\/\/|\/\*|\*|#)/.test(text) ||
		/^(import|export|use|package)\b/.test(text)
	);
}

/**
 * 連続する N 行がそっくりな塊を探す。
 *
 * 構文解析はしない（言語ごとに書くと保守できない）。**行の並びが完全に一致するもの**だけを
 * 「そっくり」と見なす。似ているだけのものは出さない — 誤検知のほうが害が大きい。
 */
export function findDuplicateBlocks(
	files: readonly { path: string; content: string }[],
	blockSize = 6
): DuplicateBlock[] {
	const seen = new Map<string, { sample: string; places: { file: string; line: number }[] }>();

	for (const file of files) {
		const lines = file.content.split('\n');
		for (let i = 0; i + blockSize <= lines.length; i++) {
			const block = lines.slice(i, i + blockSize);
			// 閉じ括弧や短い行は普通のコードにも混ざる。**半分以上が中身の無い行のときだけ**捨てる
			// （`some` で捨てると `}` を含む塊がすべて落ちて、何も見つからなくなる）
			if (block.filter(isNoise).length * 2 >= blockSize) {
				continue;
			}
			const key = block.map(normalizeLine).join('\n');
			const entry = seen.get(key) ?? { sample: block.join('\n'), places: [] };
			// 同じファイルの重なった位置は 1 つに畳む（ずらしながら何度も当たるため）
			const last = entry.places[entry.places.length - 1];
			if (last && last.file === file.path && i - last.line < blockSize) {
				continue;
			}
			entry.places.push({ file: file.path, line: i });
			seen.set(key, entry);
		}
	}

	return [...seen.values()]
		.filter((entry) => entry.places.length > 1)
		.sort((a, b) => b.places.length - a.places.length);
}

/** 読める形にする */
export function renderCodeHealth(naming: readonly NamingIssue[], duplicates: readonly DuplicateBlock[]): string {
	const lines = ['# 命名と重複', ''];

	if (naming.length === 0 && duplicates.length === 0) {
		lines.push('揺れている名前も、そっくりな実装も見つかりませんでした。');
		return lines.join('\n') + '\n';
	}

	if (naming.length > 0) {
		lines.push('## 同じ概念に別の綴りが使われています', '');
		for (const issue of naming.slice(0, 20)) {
			lines.push(`- ${issue.variants.map((v) => `\`${v.name}\`（${v.count}）`).join(' / ')}`);
		}
		lines.push('');
	}

	if (duplicates.length > 0) {
		lines.push('## そっくりな実装', '');
		for (const block of duplicates.slice(0, 10)) {
			lines.push(`- ${block.places.length} か所: ${block.places.map((p) => `\`${p.file}:${p.line + 1}\``).join(' / ')}`);
		}
		lines.push('');
	}

	lines.push('---', '', '**直すかどうかは人が決めてください。** ここは「増えていること」を見せる場所です。');
	return lines.join('\n') + '\n';
}
