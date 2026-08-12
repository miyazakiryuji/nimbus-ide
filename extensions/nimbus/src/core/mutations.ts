/**
 * ミューテーションテストによるテストの質評価（tasks.md T-182）。
 *
 * カバレッジは「実行されたか」しか言わない。**実行されているのに何も確かめていない**
 * テストは、カバレッジ 100% でも通ってしまう。
 *
 * 見分ける方法は 1 つ — コードをわざと壊して、**テストが落ちるかどうか**を見る。
 * 落ちなければ、そこは誰も守っていない。
 *
 * ここでは「壊し方の候補」を出すところまでを扱う。実際に入れて走らせるのはセッション側。
 * VS Code に依存しない。
 */

export interface Mutation {
	/** 1 起点の行 */
	line: number;
	/** 置き換える前 */
	from: string;
	/** 置き換えた後 */
	to: string;
	/** その行のソース（前後を見なくても判断できるように） */
	source: string;
}

/**
 * 壊し方の候補。**意味が変わることが確実なもの**だけを並べる。
 * 「たぶん変わる」ものを混ぜると、落ちない理由が「壊れていないから」になってしまう。
 */
const OPERATORS: { from: string; to: string }[] = [
	{ from: '>=', to: '>' },
	{ from: '<=', to: '<' },
	{ from: '===', to: '!==' },
	{ from: '!==', to: '===' },
	{ from: '==', to: '!=' },
	{ from: '&&', to: '||' },
	{ from: '||', to: '&&' },
	{ from: 'true', to: 'false' },
	{ from: 'false', to: 'true' }
];

/** コメントと文字列の中は壊さない（意味が変わらないか、ただ壊れるだけ） */
function isSkippable(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('#');
}

/** 1 ファイルから候補を集める。多すぎても回せないので上限を置く */
export function findMutations(text: string, limit = 12): Mutation[] {
	const found: Mutation[] = [];
	const lines = text.split(/\r?\n/);
	for (let index = 0; index < lines.length && found.length < limit; index++) {
		const source = lines[index];
		if (isSkippable(source)) {
			continue;
		}
		for (const operator of OPERATORS) {
			// `>=` を先に見ているので、`>` だけの誤検出は起きない
			if (!source.includes(operator.from)) {
				continue;
			}
			// 語としての true / false だけを対象にする（`trueValue` を壊さない）
			if (/^[a-z]+$/.test(operator.from) && !new RegExp(`\\b${operator.from}\\b`).test(source)) {
				continue;
			}
			found.push({ line: index + 1, from: operator.from, to: operator.to, source: source.trim() });
			break;
		}
	}
	return found;
}

/** 画面に出す一覧 */
export function describeMutations(file: string, mutations: readonly Mutation[]): string {
	if (mutations.length === 0) {
		return `${file} には、確実に意味が変わる壊し方が見つかりませんでした。`;
	}
	return [
		`${file}: ${mutations.length} 通りの壊し方が作れます`,
		...mutations.map((mutation) => `  ${mutation.line}: ${mutation.from} → ${mutation.to}  ${mutation.source}`)
	].join('\n');
}

/**
 * セッションへ投入する文。
 * **1 つずつ入れて、必ず戻す**を守らせるのが要点（戻し忘れが一番危ない）。
 */
export function buildMutationPrompt(file: string, mutations: readonly Mutation[]): string {
	if (mutations.length === 0) {
		return '';
	}
	return [
		`${file} のテストが、本当に振る舞いを守っているかを確かめます（ミューテーションテスト）。`,
		'',
		'次の壊し方を **1 つずつ** 試してください:',
		'',
		...mutations.map((mutation, index) => `${index + 1}. ${mutation.line} 行目: \`${mutation.from}\` を \`${mutation.to}\` に`),
		'',
		'手順（1 つごとに繰り返す）:',
		'1. その 1 か所だけを書き換える',
		'2. 関係するテストを走らせる',
		'3. **必ず元に戻す**（次に進む前に、書き換えを戻したことを確かめる）',
		'',
		'**テストが落ちなかった壊し方**を挙げてください。そこは誰も守っていない振る舞いです。',
		'落ちなかったものについて、どんなテストを足せば捕まえられるかも書いてください。',
		'',
		'コードの改善はしないでください。**確かめるだけ**です。'
	].join('\n');
}
