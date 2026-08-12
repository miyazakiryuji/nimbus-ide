/**
 * 大規模な一括変更（tasks.md T-110）。
 *
 * ライブラリの破壊的変更への追従は、**一度に全部やると必ず失敗する**。
 * 差分が大きすぎてレビューできず、途中で落ちたときにどこまで正しいのかも分からない。
 *
 * ここでやるのは 2 つだけ — **影響範囲を先に数えること**と、
 * **まとまりに分けて、間にテストを挟ませること**。置き換えの残りは
 * [refactor-progress](../../../nimbus/docs/specs/refactor-progress.md) が数える。
 *
 * VS Code に依存しない。まとめ方と頼み方だけを置く。
 */

/** 1 まとまりに入れるファイル数の上限。これ以上はレビューできない */
const BATCH_SIZE = 8;

/** 上位ディレクトリでまとめる。同じ層は同じ直し方になることが多い */
export function groupByDirectory(files: readonly string[]): { directory: string; files: string[] }[] {
	const groups = new Map<string, string[]>();
	for (const file of files) {
		const index = file.lastIndexOf('/');
		const directory = index > 0 ? file.slice(0, index) : '.';
		groups.set(directory, [...(groups.get(directory) ?? []), file]);
	}
	return [...groups.entries()]
		.map(([directory, entries]) => ({ directory, files: entries.sort() }))
		.sort((a, b) => b.files.length - a.files.length || a.directory.localeCompare(b.directory));
}

/** ディレクトリの塊を、レビューできる大きさに割る */
export function planBatches(files: readonly string[], size: number = BATCH_SIZE): string[][] {
	const batches: string[][] = [];
	for (const group of groupByDirectory(files)) {
		for (let index = 0; index < group.files.length; index += size) {
			batches.push(group.files.slice(index, index + size));
		}
	}
	return batches;
}

export interface MigrationInput {
	/** 追従する対象（パッケージ名や API 名） */
	target: string;
	/** 影響を受けるファイル（相対パス） */
	files: readonly string[];
	/** 分かっていれば、何がどう変わるか */
	note?: string;
}

/** 画面に出す要約 */
export function describeMigration(input: MigrationInput): string {
	if (input.files.length === 0) {
		return `${input.target} を使っている箇所は見つかりませんでした。`;
	}
	const batches = planBatches(input.files);
	const groups = groupByDirectory(input.files);
	return [
		`${input.target}: ${input.files.length} ファイル / ${groups.length} ディレクトリ / ${batches.length} 回に分けて進めます`,
		...groups.slice(0, 10).map((group) => `  ${group.directory}/ — ${group.files.length} ファイル`)
	].join('\n');
}

/**
 * セッションへ投入する文。
 * **「まとまりごとに、テストを挟みながら」**を最初に固定するのが要点。
 */
export function buildMigrationPrompt(input: MigrationInput): string {
	if (input.files.length === 0) {
		return '';
	}
	const batches = planBatches(input.files);
	const parts = [
		`${input.target} の変更に追従します。影響を受けるのは ${input.files.length} ファイルです。`,
		'',
		'**一度に全部直さないでください。** 次のまとまりごとに進めてください:',
		''
	];
	batches.forEach((batch, index) => {
		parts.push(`${index + 1}. ${batch.join(', ')}`);
	});
	parts.push(
		'',
		'各まとまりで、**直す → 型を確かめる → 関係するテストを走らせる**まで済ませてから次へ進んでください。',
		'途中で落ちたら、そこで止めて報告してください。'
	);
	if (input.note) {
		parts.push('', '分かっている変更点:', input.note);
	}
	parts.push('', '最初のまとまりから始めてください。');
	return parts.join('\n');
}
