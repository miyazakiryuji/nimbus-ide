/**
 * 型・スキーマの変更が壊す場所を洗い出す（tasks.md T-123）。
 *
 * バックエンドの型が変わったとき、フロント側のどこが壊れるかは
 * **型エラーが出るまで分からない**。ビルドが通る言語（動的型・別リポジトリ）なら、
 * 実行するまで分からない。
 *
 * 変わった型の名前さえ分かれば、参照検索で「触っている場所」は機械的に出せる。
 * VS Code に依存しない部分（差分の読み取りと見せ方）だけをここに置く。
 */

/** 差分から、変わった**型**の名前を拾う（関数や定数は対象外） */
const CHANGED_TYPE = /^[+-]\s*export\s+(?:default\s+)?(?:abstract\s+)?(?:interface|type|enum|class)\s+([A-Za-z_$][\w$]*)/;

export function changedTypes(diff: string): string[] {
	const names = new Set<string>();
	for (const line of diff.split('\n')) {
		if (line.startsWith('+++') || line.startsWith('---')) {
			continue;
		}
		const match = CHANGED_TYPE.exec(line);
		if (match) {
			names.add(match[1]);
		}
	}
	return [...names];
}

export interface TypeImpact {
	/** 変わった型 */
	type: string;
	/** その型を参照しているファイル（定義元は除く・相対パス） */
	files: string[];
}

/** 影響の大きい順。触っているファイルが多いものから見る */
export function rankImpacts(impacts: readonly TypeImpact[]): TypeImpact[] {
	return [...impacts]
		.filter((impact) => impact.files.length > 0)
		.sort((a, b) => b.files.length - a.files.length || a.type.localeCompare(b.type));
}

/** 画面に出す一覧 */
export function describeImpacts(impacts: readonly TypeImpact[]): string {
	const ranked = rankImpacts(impacts);
	if (ranked.length === 0) {
		return '変わった型を参照している場所は見つかりませんでした。';
	}
	const total = new Set(ranked.flatMap((impact) => impact.files)).size;
	return [
		`変わった型 ${ranked.length} 件を、${total} ファイルが参照しています`,
		...ranked.map((impact) => `  ${impact.type}: ${impact.files.length} ファイル`)
	].join('\n');
}

/**
 * セッションへ投入する文。
 * **「直して」ではなく「壊れていないかを確かめて」。** 参照しているだけで
 * 影響が無いことの方が多い。
 */
export function buildImpactPrompt(impacts: readonly TypeImpact[], limit = 12): string {
	const ranked = rankImpacts(impacts);
	if (ranked.length === 0) {
		return '';
	}
	const parts = ['型の定義を変えました。**参照している場所が壊れていないか**を確かめてください。', ''];
	for (const impact of ranked) {
		parts.push(`### ${impact.type}`, '');
		parts.push(...impact.files.slice(0, limit).map((file) => `- ${file}`));
		if (impact.files.length > limit) {
			parts.push(`- …他 ${impact.files.length - limit} ファイル`);
		}
		parts.push('');
	}
	parts.push(
		'**参照しているだけで影響が無い場所の方が多い**ので、まず読んで判断してください。',
		'壊れている場所だけを直し、影響が無かったものは「問題なし」と報告してください。'
	);
	return parts.join('\n');
}
