/**
 * API ドキュメントの追従（tasks.md T-209）。
 *
 * 公開 API を変えたのにドキュメントが古いままなのは、**コメントだけ古い**のと同じで、
 * 読む人を積極的に間違えさせる。しかも差分レビューでは気づけない
 * （変わっていないファイルは差分に出ない）。
 *
 * 機械で分かるのは「**その名前に触れている文書が、今回変わっていない**」まで。
 * 直すかどうかは読んで決める。
 *
 * VS Code に依存しない。
 */

/** 差分から、公開されている名前の変更を拾う */
const EXPORTED = /^[+-]\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;

export function changedExports(diff: string): string[] {
	const names = new Set<string>();
	for (const line of diff.split('\n')) {
		// `+++ b/...` のようなヘッダは対象外
		if (line.startsWith('+++') || line.startsWith('---')) {
			continue;
		}
		const match = EXPORTED.exec(line);
		if (match) {
			names.add(match[1]);
		}
	}
	return [...names];
}

export interface DocFile {
	path: string;
	text: string;
}

export interface StaleDoc {
	/** 変わった公開名 */
	symbol: string;
	/** その名前に触れているのに、今回変わっていない文書 */
	docs: string[];
}

/** 名前として言及されているか（部分一致で拾うと `run` があらゆる文書に当たる） */
function mentions(text: string, symbol: string): boolean {
	return new RegExp(`(^|[^\\w$])${symbol}([^\\w$]|$)`).test(text);
}

/**
 * 変わった公開名に触れているのに、今回の変更に含まれていない文書を挙げる。
 * **触れている文書が無い名前は挙げない** — 書かれていないものは古くなりようがない。
 */
export function findStaleDocs(
	symbols: readonly string[],
	changedFiles: readonly string[],
	docs: readonly DocFile[]
): StaleDoc[] {
	const changed = new Set(changedFiles);
	const stale: StaleDoc[] = [];
	for (const symbol of symbols) {
		const hits = docs
			.filter((doc) => !changed.has(doc.path) && mentions(doc.text, symbol))
			.map((doc) => doc.path)
			.sort();
		if (hits.length > 0) {
			stale.push({ symbol, docs: hits });
		}
	}
	return stale;
}

/** 画面に出す一覧 */
export function describeStaleDocs(stale: readonly StaleDoc[]): string {
	if (stale.length === 0) {
		return '公開している名前を変えた形跡はありますが、追従が要る文書は見つかりませんでした。';
	}
	return [
		`変えた名前に触れている文書が ${stale.length} 件あります（今回の変更に含まれていません）`,
		...stale.map((entry) => `  ${entry.symbol}: ${entry.docs.join(', ')}`)
	].join('\n');
}

/** セッションへ投入する文。**直すとは限らない**ので、確かめてから直させる */
export function buildDocUpdatePrompt(stale: readonly StaleDoc[]): string {
	if (stale.length === 0) {
		return '';
	}
	return [
		'公開している名前を変えましたが、次の文書は今回の変更に含まれていません。',
		'',
		...stale.map((entry) => `- \`${entry.symbol}\` → ${entry.docs.map((doc) => `\`${doc}\``).join(', ')}`),
		'',
		'それぞれ**実際に古くなっているかを確かめてから**直してください。',
		'名前が一致しているだけで、関係のない記述のこともあります。',
		'古くなっていないものは「問題なし」と報告してください。'
	].join('\n');
}
