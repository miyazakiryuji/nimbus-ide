/**
 * コミットメッセージの型と、生成の下ごしらえ（tasks.md T-305 / T-309）。
 *
 * 生成ボタンが**何に合わせて書くか**をここで決める。約束は 2 つ:
 *
 * - **分かるものは推測させない**（`conventions.ts` と同じ考えかた）。型は過去のコミットから
 *   数えて当てる。ただし conventions が数えているのは**コードの書き方**なので、
 *   コミットの型はここで別に数える
 * - **材料は staged だけ。** 勝手に `git add` しない — 並行セッションでは
 *   他人の変更を巻き込むため
 *
 * VS Code にも git にも依存しない（文字列を受け取り、文字列を返す）。
 */

/** 選べる型（T-309） */
export type CommitStyle = 'repo' | 'conventional' | 'template';

/** Conventional Commits の 1 行目（`feat(scope): …` / `fix!: …`） */
const CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/;

/** 型ごとの数え上げ。picker で「いまの型」を根拠つきで見せるために返す */
export interface StyleCounts {
	conventional: number;
	other: number;
	total: number;
}

/**
 * 過去のコミットの 1 行目から、いまの型を当てる。
 *
 * `repo` は「このリポジトリの型 = 過去のコミットの形をまねる」。
 * Nimbus のリポジトリなら `Nimbus: 〜（T-xxx）` がそれに当たるが、
 * **形をここに書き込まない** — 利用者のリポジトリごとに違うので、
 * 実例（最近の 1 行目）をそのまま手本として渡す。
 */
export function detectCommitStyle(subjects: readonly string[]): { style: CommitStyle; counts: StyleCounts } {
	const meaningful = subjects.map((line) => line.trim()).filter((line) => line.length > 0);
	const conventional = meaningful.filter((line) => CONVENTIONAL.test(line)).length;
	const counts: StyleCounts = {
		conventional,
		other: meaningful.length - conventional,
		total: meaningful.length
	};
	// 過半数が Conventional なら、そのリポジトリの型は Conventional
	const style: CommitStyle = counts.total > 0 && conventional * 2 > counts.total ? 'conventional' : 'repo';
	return { style, counts };
}

/** 過去の 1 行目から言語を当てる（設定が `auto` のとき） */
export function detectLanguage(subjects: readonly string[]): 'ja' | 'en' {
	const sample = subjects.slice(0, 20).join(' ');
	return /[぀-ヿ一-鿿]/.test(sample) ? 'ja' : 'en';
}

/** picker に出す型の言いかた（T-309: 生成の前に「いまの型」を画面に出す） */
export function describeStyle(style: CommitStyle): string {
	switch (style) {
		case 'repo':
			return 'このリポジトリの型（過去のコミットをまねる）';
		case 'conventional':
			return 'Conventional Commits（feat(scope): …）';
		case 'template':
			return 'テンプレート（git config commit.template）';
	}
}

export interface TruncatedDiff {
	text: string;
	truncated: boolean;
}

/**
 * 巨大な diff を、モデルに渡せる大きさに切り詰める（T-305 の確認項目 ②）。
 *
 * **ファイルの境界で切る。** 文字数で機械的に切ると、hunk の途中で千切れて
 * 「何のファイルの話か」が消える。入りきらないファイルは名前だけ残す —
 * 中身が無くても「触っていること」は 1 行目の材料になる。
 */
export function truncateDiff(diff: string, maxChars = 24_000): TruncatedDiff {
	if (diff.length <= maxChars) {
		return { text: diff, truncated: false };
	}
	const files = diff.split(/^(?=diff --git )/m);
	const kept: string[] = [];
	const omitted: string[] = [];
	let used = 0;
	for (const file of files) {
		if (used + file.length <= maxChars) {
			kept.push(file);
			used += file.length;
		} else {
			const name = /^diff --git a\/(\S+)/.exec(file)?.[1] ?? '(不明なファイル)';
			omitted.push(name);
		}
	}
	const note =
		omitted.length > 0
			? `\n（大きすぎるため ${omitted.length} ファイルの中身を省略: ${omitted.join(', ')}）\n`
			: '';
	return { text: kept.join('') + note, truncated: true };
}

export interface CommitPromptOptions {
	/** `git diff --staged` の中身（切り詰め済み） */
	diff: string;
	/** `git diff --staged --stat` の要約（全体像。切り詰めても必ず全ファイルが載る） */
	stat: string;
	style: CommitStyle;
	/** 手本にする過去の 1 行目（`repo` のとき） */
	recentSubjects: readonly string[];
	/** `template` のときのテンプレート本文 */
	template?: string;
	language: 'ja' | 'en';
	/** 1 行目の長さの上限 */
	subjectMax: number;
	/** 本文（1 行目の下の説明）を書くか */
	body: boolean;
	/** Co-Authored-By の行を付けるか */
	coAuthor: boolean;
}

/**
 * 生成に渡す指示文。**メッセージ以外を返させない** —
 * 返ってきたものがそのまま SCM の入力欄に入る。
 */
export function buildCommitPrompt(options: CommitPromptOptions): string {
	const lines: string[] = [
		'次の staged された変更に対するコミットメッセージを書いてください。',
		'',
		'守ること:',
		`- 1 行目は ${options.subjectMax} 文字以内`,
		options.body
			? '- 1 行目のあとに空行を 1 つ置き、**なぜこの変更をしたか**を短い本文で書く'
			: '- 本文は書かない（1 行目だけ）',
		options.language === 'ja' ? '- 日本語で書く' : '- Write in English',
		'- **コミットメッセージだけ**を返す。前置き・説明・コードフェンスは書かない'
	];
	if (options.coAuthor) {
		lines.push('- 末尾に `Co-Authored-By:` の行があれば残す。なければ足さない（署名はツール側で足す）');
	}
	lines.push('');
	switch (options.style) {
		case 'conventional':
			lines.push('型: Conventional Commits。`type(scope): summary` の形。type は feat / fix / docs / refactor / test / chore など。');
			break;
		case 'template':
			lines.push('型: 次のテンプレートの構造に従う。', '```', options.template ?? '', '```');
			break;
		case 'repo':
			lines.push('型: このリポジトリの過去のコミットと**同じ形**にする。最近の 1 行目:');
			for (const subject of options.recentSubjects.slice(0, 8)) {
				lines.push(`- ${subject}`);
			}
			break;
	}
	lines.push('', '変更の全体像:', '```', options.stat.trim(), '```', '', '変更の中身:', '```diff', options.diff.trim(), '```');
	return lines.join('\n');
}

/**
 * 返ってきたものをメッセージとして整える。
 *
 * 指示していても、モデルは前置きやコードフェンスを付けることがある。
 * **入力欄に入れる直前の砦**なので、剥がせるものはここで剥がす。
 */
export function cleanGeneratedMessage(raw: string): string {
	let text = raw.trim();
	// ```で全体が包まれていたら中身だけにする
	const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(text);
	if (fenced) {
		text = fenced[1].trim();
	}
	// 「コミットメッセージ:」のような前置きの 1 行を落とす
	text = text.replace(/^(コミットメッセージ|commit message)\s*[:：]\s*\n?/i, '');
	return text.trim();
}

/**
 * メッセージが型に合っているかの検査（T-307 の `git_commit` が使う）。
 * 合っていなければ**理由を言葉で返す**（黙って直さない — 直すのは書いた側）。
 */
export function checkMessageStyle(
	message: string,
	style: CommitStyle,
	subjectMax: number
): string | undefined {
	const subject = message.split('\n', 1)[0]?.trim() ?? '';
	if (subject.length === 0) {
		return '1 行目が空です。';
	}
	if (subject.length > subjectMax) {
		return `1 行目が ${subject.length} 文字あります（上限 ${subjectMax} 文字）。`;
	}
	if (style === 'conventional' && !CONVENTIONAL.test(subject)) {
		return '1 行目が Conventional Commits（`type(scope): summary`）の形になっていません。';
	}
	const second = message.split('\n')[1];
	if (second !== undefined && second.trim() !== '') {
		return '1 行目と本文の間に空行がありません。';
	}
	return undefined;
}
