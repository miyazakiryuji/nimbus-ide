/**
 * 壊してもいい場所を作る（tasks.md T-046 練習用サンドボックス / T-213 サンプル同梱）。
 *
 * エージェントに任せるのが怖いのは、**失敗したときに何が起きるか分からない**から。
 * 自分のリポジトリで試すと、怖くて承認を全部拒否することになる。
 * 壊れても困らない小さな場所があれば、承認・差分・巻き戻しをひととおり試せる。
 *
 * 中身は「直すところがある」状態で置く。**動くだけのサンプルは練習にならない。**
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface SandboxFile {
	path: string;
	content: string;
}

/** 練習用の小さなリポジトリ一式 */
export function buildSandboxFiles(name = 'nimbus-sandbox'): SandboxFile[] {
	return [
		{
			path: 'README.md',
			content: [
				`# ${name}`,
				'',
				'Nimbus を試すための、**壊してもいい**場所です。消しても誰も困りません。',
				'',
				'## やってみること',
				'',
				'1. コックピットに「`greet` が空文字のときに落ちるので直して」と書いて Enter',
				'2. 差分が出たら、**中身を読んでから**許可・拒否を選ぶ',
				'3. `node test.mjs` で確かめる（落ちていたテストが通れば成功）',
				'4. 気に入らなければ拒否して、別の指示を出す',
				'',
				'## 置いてあるもの',
				'',
				'- `src/greet.mjs` — わざと壊してある関数',
				'- `test.mjs` — いま落ちるテスト',
				'- `CLAUDE.md` — このフォルダでの決まりごと',
				''
			].join('\n')
		},
		{
			path: 'CLAUDE.md',
			content: [
				'# 決まりごと',
				'',
				'- 変更は最小限に。動いているものは触らない',
				'- 直したら `node test.mjs` を実行して確かめる',
				'- コメントは「なぜ」を書く。「何を」はコードを読めば分かる',
				''
			].join('\n')
		},
		{
			path: 'src/greet.mjs',
			content: [
				'/**',
				' * 名前を受け取って挨拶を返す。',
				' *',
				' * いまは空文字を渡すと "こんにちは、さん" になってしまう（練習用にわざと残してある）。',
				' */',
				'export function greet(name) {',
				'\treturn `こんにちは、${name}さん`;',
				'}',
				''
			].join('\n')
		},
		{
			path: 'test.mjs',
			content: [
				"import { greet } from './src/greet.mjs';",
				'',
				'const cases = [',
				"\t['りゅうじ', 'こんにちは、りゅうじさん'],",
				"\t['', 'こんにちは']",
				'];',
				'',
				'let failed = 0;',
				'for (const [input, expected] of cases) {',
				'\tconst actual = greet(input);',
				'\tif (actual !== expected) {',
				'\t\tfailed++;',
				'\t\tconsole.error(`NG: greet(${JSON.stringify(input)}) => ${JSON.stringify(actual)}（期待: ${JSON.stringify(expected)}）`);',
				'\t}',
				'}',
				'',
				'console.log(failed === 0 ? "OK: すべて通りました" : `${failed} 件落ちています`);',
				'process.exit(failed === 0 ? 0 : 1);',
				''
			].join('\n')
		},
		{
			path: '.gitignore',
			content: ['node_modules/', '.DS_Store', ''].join('\n')
		}
	];
}

/** 置き場の名前（同じ名前が既にあっても上書きしないよう、呼び出し側で確かめる） */
export function sandboxFolderName(now: Date): string {
	const stamp = now.toISOString().slice(0, 10).replace(/-/g, '');
	return `nimbus-sandbox-${stamp}`;
}
