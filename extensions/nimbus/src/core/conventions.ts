/**
 * プロジェクト固有の書き方を数える（tasks.md T-103）。
 *
 * 「既存のコードに合わせて」と言っても、何に合わせるのかを知らなければ守れない。
 * インデント・引用符・セミコロン・ファイル名の付け方・テストの置き場所は、
 * **既存のファイルを数えれば分かる**。分かるものは推測させない。
 *
 * VS Code に依存しない。数え方と、渡す文の組み立てだけを置く。
 */

export interface FileSample {
	/** ワークスペースからの相対パス */
	path: string;
	text: string;
}

export interface Conventions {
	/** `tab` / `2 spaces` / `4 spaces` など */
	indent?: string;
	quotes?: 'single' | 'double';
	semicolons?: boolean;
	/** ファイル名の付け方 */
	fileNaming?: 'camelCase' | 'PascalCase' | 'kebab-case' | 'snake_case';
	/** テストの置き場所（`test/` の下 / 実装の隣） */
	testLocation?: 'separate' | 'beside';
	/** 数えたファイル数 */
	sampled: number;
}

function majority<T extends string>(counts: Map<T, number>, minimum = 0.6): T | undefined {
	let total = 0;
	let best: { key: T; count: number } | undefined;
	for (const [key, count] of counts) {
		total += count;
		if (!best || count > best.count) {
			best = { key, count };
		}
	}
	// はっきり多いものだけを「流儀」と呼ぶ。半々のものに従わせても迷わせるだけ
	return best && total > 0 && best.count / total >= minimum ? best.key : undefined;
}

function indentOf(text: string): string | undefined {
	const counts = new Map<string, number>();
	for (const line of text.split('\n')) {
		const match = /^([\t ]+)\S/.exec(line);
		if (!match) {
			continue;
		}
		const lead = match[1];
		const key = lead.startsWith('\t') ? 'tab' : `${Math.min(lead.length, 8)} spaces`;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	// 空白は 2 / 4 が混ざる（入れ子）ので、いちばん浅いものを採る
	const spaces = [...counts.keys()].filter((key) => key !== 'tab');
	if ((counts.get('tab') ?? 0) > spaces.reduce((total, key) => total + (counts.get(key) ?? 0), 0)) {
		return 'tab';
	}
	const shallowest = spaces.map((key) => Number.parseInt(key, 10)).filter((n) => n > 0).sort((a, b) => a - b)[0];
	return shallowest ? `${shallowest} spaces` : undefined;
}

function namingOf(path: string): Conventions['fileNaming'] | undefined {
	const base = (path.split('/').pop() ?? '').replace(/\.[^.]+$/, '').replace(/\.(test|spec)$/, '');
	if (base.length === 0 || /^[a-z0-9]+$/.test(base)) {
		return undefined;
	}
	if (/^[A-Z][A-Za-z0-9]*$/.test(base)) {
		return 'PascalCase';
	}
	if (/^[a-z][A-Za-z0-9]*$/.test(base)) {
		return 'camelCase';
	}
	if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(base)) {
		return 'kebab-case';
	}
	if (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(base)) {
		return 'snake_case';
	}
	return undefined;
}

/** 既存ファイルを数えて、はっきりしている流儀だけを返す */
export function detectConventions(samples: readonly FileSample[]): Conventions {
	const indents = new Map<string, number>();
	const quotes = new Map<'single' | 'double', number>();
	const semis = new Map<'yes' | 'no', number>();
	const naming = new Map<NonNullable<Conventions['fileNaming']>, number>();
	const testPlace = new Map<'separate' | 'beside', number>();

	for (const sample of samples) {
		const indent = indentOf(sample.text);
		if (indent) {
			indents.set(indent, (indents.get(indent) ?? 0) + 1);
		}

		const single = (sample.text.match(/'[^'\n]*'/g) ?? []).length;
		const double = (sample.text.match(/"[^"\n]*"/g) ?? []).length;
		if (single + double > 0) {
			quotes.set(single >= double ? 'single' : 'double', (quotes.get(single >= double ? 'single' : 'double') ?? 0) + 1);
		}

		const lines = sample.text.split('\n').filter((line) => /[;)}\w]\s*$/.test(line.trim()) && line.trim().length > 0);
		const withSemi = lines.filter((line) => line.trim().endsWith(';')).length;
		// 文らしい行が 3 行あれば十分な手がかりになる（ファイル間の多数決が効くため）
		if (lines.length >= 3) {
			semis.set(withSemi / lines.length >= 0.3 ? 'yes' : 'no', (semis.get(withSemi / lines.length >= 0.3 ? 'yes' : 'no') ?? 0) + 1);
		}

		const named = namingOf(sample.path);
		if (named) {
			naming.set(named, (naming.get(named) ?? 0) + 1);
		}

		if (/\.(test|spec)\.[cm]?[jt]sx?$|_test\.(dart|go)$/.test(sample.path)) {
			const key = /(^|\/)(test|tests|spec|__tests__)\//.test(sample.path) ? 'separate' : 'beside';
			testPlace.set(key, (testPlace.get(key) ?? 0) + 1);
		}
	}

	const semi = majority(semis);
	return {
		indent: majority(indents),
		quotes: majority(quotes),
		semicolons: semi === undefined ? undefined : semi === 'yes',
		fileNaming: majority(naming),
		testLocation: majority(testPlace),
		sampled: samples.length
	};
}

/** 画面と指示に出す一覧。**分からなかったものは書かない** */
export function renderConventions(conventions: Conventions): string {
	const lines: string[] = [];
	if (conventions.indent) {
		lines.push(`- インデント: ${conventions.indent}`);
	}
	if (conventions.quotes) {
		lines.push(`- 引用符: ${conventions.quotes === 'single' ? "'シングル'" : '"ダブル"'}`);
	}
	if (conventions.semicolons !== undefined) {
		lines.push(`- 行末のセミコロン: ${conventions.semicolons ? 'つける' : 'つけない'}`);
	}
	if (conventions.fileNaming) {
		lines.push(`- ファイル名: ${conventions.fileNaming}`);
	}
	if (conventions.testLocation) {
		lines.push(
			`- テストの置き場所: ${conventions.testLocation === 'separate' ? '`test/` の下にまとめる' : '実装の隣に置く'}`
		);
	}
	if (lines.length === 0) {
		return `${conventions.sampled} ファイルを見ましたが、はっきりした流儀は見つかりませんでした。`;
	}
	return [`${conventions.sampled} ファイルから数えた、このリポジトリの書き方:`, ...lines].join('\n');
}

/** セッションへ渡す文 */
export function buildConventionsPrompt(conventions: Conventions): string {
	const body = renderConventions(conventions);
	if (!body.includes('- ')) {
		return '';
	}
	return [
		'このリポジトリの書き方です。**推測ではなく既存のファイルを数えた結果**なので、これに合わせてください。',
		'',
		body,
		'',
		'ここに書かれていない点は、周りのコードに合わせてください。'
	].join('\n');
}
