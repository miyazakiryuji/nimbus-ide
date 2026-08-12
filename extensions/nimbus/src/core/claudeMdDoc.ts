/**
 * CLAUDE.md を「セクションの集まり」として扱う。
 *
 * CLAUDE.md は毎セッション必ず読まれるので、書いたことがそのまま課金と精度に効く。
 * それなのに普段はただのテキストファイルで、どこに何が書いてあるか・どの階層のものが
 * 効いているかが見えない。ここでは見出し単位に切り分けて、場所を指して直せるようにする。
 *
 * VS Code に依存しないので単体で検証できる（探索そのものは `claudeMd.ts`）。
 */
import { dirname, join, sep } from 'path';

/** CLAUDE.md がどの階層のものか */
export type ClaudeMdOrigin = 'project' | 'ancestor' | 'user';

export interface ClaudeMdSection {
	/** 見出しの文字列（`#` を除いたもの）。前書き（見出しの前）は空文字 */
	title: string;
	/** 見出しの深さ（`#` の数）。前書きは 0 */
	level: number;
	/** 0 始まりの行番号。エディタで該当行へ飛ぶために持つ */
	line: number;
	/** 見出しを含む本文（末尾の空行は落とす） */
	body: string;
}

/**
 * どの階層の CLAUDE.md かを決める。
 *
 * - `user`: `<home>/.claude/CLAUDE.md`
 * - `project`: 開いているフォルダ直下
 * - `ancestor`: それより上（親フォルダから継承しているもの）
 *
 * 「どれが効いているか」より「**どれを直せばいいか**」が知りたいので、
 * プロジェクトのものと継承しているものを分ける。
 */
export function classifyOrigin(path: string, workspaceRoot: string | undefined, home: string): ClaudeMdOrigin {
	if (path === join(home, '.claude', 'CLAUDE.md')) {
		return 'user';
	}
	if (workspaceRoot && dirname(path) === workspaceRoot) {
		return 'project';
	}
	return 'ancestor';
}

/** 一覧に出す短い名前。フルパスは長すぎて読めないので、意味のある部分だけ残す */
export function displayLabel(path: string, workspaceRoot: string | undefined, home: string): string {
	if (workspaceRoot && path.startsWith(workspaceRoot + sep)) {
		return path.slice(workspaceRoot.length + 1);
	}
	if (path.startsWith(home + sep)) {
		return '~' + path.slice(home.length);
	}
	return path;
}

/**
 * 見出しで区切る。
 *
 * コードブロック内の `#` は見出しではない（シェルのコメントが見出しに化けると、
 * 実際には存在しないセクションが一覧に並ぶ）。フェンスの中は数えない。
 */
export function parseSections(content: string): ClaudeMdSection[] {
	const lines = content.split('\n');
	const sections: ClaudeMdSection[] = [];
	let current: { title: string; level: number; line: number; body: string[] } | undefined;
	let inFence = false;

	const flush = (): void => {
		if (!current) {
			return;
		}
		const body = current.body.join('\n').replace(/\n+$/, '');
		if (current.level > 0 || body.trim().length > 0) {
			sections.push({ title: current.title, level: current.level, line: current.line, body });
		}
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
		}
		const heading = inFence ? null : /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			flush();
			current = { title: heading[2].trim(), level: heading[1].length, line: i, body: [line] };
			continue;
		}
		if (!current) {
			// 最初の見出しより前（前書き）。中身があるときだけ 1 つのセクションとして扱う
			current = { title: '', level: 0, line: 0, body: [] };
		}
		current.body.push(line);
	}
	flush();
	return sections;
}

/**
 * セクションを足す。
 *
 * 末尾に追記する。既に同じ見出しがあるときは**足さずにその行を返す**
 * （CLAUDE.md は放っておくと重複で太る場所なので、同じ節を二度作らせない）。
 */
export function appendSection(content: string, heading: string, body: string): { content: string; line: number } {
	const existing = parseSections(content).find((s) => s.title === heading);
	if (existing) {
		return { content, line: existing.line };
	}
	const trimmed = content.replace(/\n+$/, '');
	const line = trimmed.length === 0 ? 0 : trimmed.split('\n').length + 1;
	const section = `## ${heading}\n\n${body}\n`;
	const next = trimmed.length === 0 ? section : `${trimmed}\n\n${section}`;
	return { content: next, line };
}

/**
 * 節の中に箇条書きを 1 行足す。節が無ければ作る。
 *
 * 「毎回言っている指示」を CLAUDE.md へ移すための操作。節ごと足す（`appendSection`）と
 * 見出しが増えていくので、同じ趣旨のものは 1 つの節に溜める。
 * 同じ内容が既にあるときは足さず、その行を返す（重複で太らせないのは追記と同じ方針）。
 */
export function appendBullet(content: string, heading: string, bullet: string): { content: string; line: number } {
	const text = bullet.trim();
	const sections = parseSections(content);
	const target = sections.find((s) => s.title === heading);
	if (!target) {
		const created = appendSection(content, heading, `- ${text}`);
		return { content: created.content, line: created.line + 2 };
	}

	const lines = content.split('\n');
	const bodyLines = target.body.split('\n');
	const existing = bodyLines.findIndex((line) => line.trim().replace(/^[-*+]\s*/, '') === text);
	if (existing >= 0) {
		return { content, line: target.line + existing };
	}

	// 節の本文の末尾（次の見出しの直前、末尾の空行より前）に足す
	let insertAt = target.line + bodyLines.length;
	while (insertAt > target.line + 1 && lines[insertAt - 1]?.trim() === '') {
		insertAt--;
	}
	lines.splice(insertAt, 0, `- ${text}`);
	return { content: lines.join('\n'), line: insertAt };
}

/** リンターの指摘。行を持つのは、指摘から直接その場所へ飛ばすため */
export interface ClaudeMdFinding {
	kind: 'duplicate-heading' | 'duplicate-line' | 'empty-section' | 'too-long';
	message: string;
	line: number;
}

/**
 * 1 文字あたりのトークン数のおおよその目安。
 * 日本語混じりの散文では 1 トークン ≒ 1〜2 文字なので、控えめに 1.5 文字で見積もる。
 * 正確な値は要らない（「長すぎる」に気づかせるための桁の目安）。
 */
const CHARS_PER_TOKEN = 1.5;

/** これを超えたら長すぎると見なす（毎ターン読まれるので、ここが太ると全部に効く） */
const LONG_TOKEN_ESTIMATE = 2000;

/** おおよそのトークン数 */
export function estimateTokens(content: string): number {
	return Math.round(content.length / CHARS_PER_TOKEN);
}

/**
 * 太りすぎ・重複を見つける。
 *
 * CLAUDE.md は毎セッション必ず読まれるので、放っておくと「効いていない指示」が
 * 毎ターンの課金と文脈を食う。書くのを止める必要はないが、**気づける**必要がある。
 *
 * 指摘するのは、機械的に判断できて直しかたが自明なものだけ。
 * 「この指示は要らない」のような価値判断はしない（それは人間が決めること）。
 */
export function lintClaudeMd(content: string): ClaudeMdFinding[] {
	const findings: ClaudeMdFinding[] = [];
	const sections = parseSections(content);

	const seenHeading = new Map<string, number>();
	for (const section of sections) {
		if (section.level === 0) {
			continue;
		}
		const key = section.title.trim().toLowerCase();
		const first = seenHeading.get(key);
		if (first !== undefined) {
			findings.push({
				kind: 'duplicate-heading',
				message: `「${section.title}」が重複しています（${first + 1} 行目にも）`,
				line: section.line
			});
		} else {
			seenHeading.set(key, section.line);
		}
		// 見出しだけで中身が無い節は、読ませる価値が無いのに文脈を食う
		const body = section.body.split('\n').slice(1).join('\n').trim();
		if (body.length === 0) {
			findings.push({
				kind: 'empty-section',
				message: `「${section.title}」に中身がありません`,
				line: section.line
			});
		}
	}

	// 同じ指示を別々の場所に書いてしまうのはよくある。箇条書き 1 行単位で見る
	const seenLine = new Map<string, number>();
	const lines = content.split('\n');
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (/^\s*(```|~~~)/.test(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) {
			continue;
		}
		const text = line.trim();
		// 短い行は偶然一致するので見ない（`---` や `## 見出し` の再掲も避ける）
		if (text.length < 12 || text.startsWith('#')) {
			continue;
		}
		const first = seenLine.get(text);
		if (first !== undefined) {
			findings.push({
				kind: 'duplicate-line',
				message: `同じ行が ${first + 1} 行目にもあります`,
				line: i
			});
		} else {
			seenLine.set(text, i);
		}
	}

	const tokens = estimateTokens(content);
	if (tokens > LONG_TOKEN_ESTIMATE) {
		findings.push({
			kind: 'too-long',
			message: `長すぎます（およそ ${tokens} トークン）。毎ターン読まれるので、効いていない節を減らすと軽くなります`,
			line: 0
		});
	}

	return findings.sort((a, b) => a.line - b.line);
}

/**
 * よく書く節のひな形。
 *
 * 「何を書けばいいか分からない」が CLAUDE.md が育たない一番の理由なので、
 * 書き出しを用意する。中身は Nimbus の思想ではなく、**そのプロジェクトの事実**を書く場所。
 */
export const SECTION_TEMPLATES: { heading: string; description: string; body: string }[] = [
	{
		heading: 'プロジェクトの概要',
		description: '何を作っているか・誰のためか（最初に読ませたい前提）',
		body: '<!-- 何を作っているか、誰のためか、今どの段階か -->'
	},
	{
		heading: 'コーディング規約',
		description: '命名・インデント・言語ごとの決まり',
		body: '<!-- 例: インデントはタブ / 型名は PascalCase / 文字列は必ず外部化する -->'
	},
	{
		heading: 'やってほしくないこと',
		description: '触ってほしくない場所・避けたいやり方',
		body: '<!-- 例: 生成物は直接編集しない / 既存の公開 API のシグネチャを変えない -->'
	},
	{
		heading: 'よく使うコマンド',
		description: 'ビルド・テスト・起動の入口',
		body: '```bash\n# 例: npm run build / npm test\n```'
	},
	{
		heading: 'テストの方針',
		description: 'どこに何を書くか・どう回すか',
		body: '<!-- 例: 単体は src/**/test に置く / 画面は docs/testing にチェックリストを作る -->'
	}
];
