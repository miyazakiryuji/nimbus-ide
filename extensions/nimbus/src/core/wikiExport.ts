/**
 * 書いたものを社内 Wiki / Notion に出す（tasks.md T-208）。
 *
 * 仕様書も ADR も、リポジトリの中にあるうちは**リポジトリを開ける人にしか届かない**。
 * 社内 Wiki に貼れば届くが、そのまま貼ると 2 つの理由で壊れる:
 *
 * 1. **相対リンクが全部死ぬ** — `[claude-md](nimbus/docs/specs/claude-md.md)` は
 *    Wiki 側では行き先が無い。読む人はリンクを踏んで、404 を見て、それきり読まなくなる
 * 2. **社外に出せないものが混ざる** — 内部の URL・人名・仮の判断が、そのまま社内 Wiki へ出る
 *
 * ここでやるのは**貼れる形に直すところまで**。**貼るのは人**
 * （どこに出すかは、その組織の話であって、機械が決めることではない）。
 *
 * VS Code に依存しない。
 */

export interface WikiOptions {
	/** `https://github.com/owner/repo` */
	repoUrl?: string;
	/** リンク先の枝やタグ。既定は `main` */
	ref?: string;
	/** 変換するファイルのリポジトリ内パス（相対リンクの基準） */
	basePath?: string;
}

export interface WikiResult {
	title?: string;
	markdown: string;
	/** 絶対 URL に直したリンクの数 */
	resolvedLinks: number;
	/** 伏せた区画の数 */
	redactedBlocks: number;
	/** 直せなかったリンク（リポジトリの URL が無いときなど） */
	unresolved: string[];
}

/** 先頭の YAML front matter を落とす */
export function stripFrontMatter(markdown: string): string {
	const match = markdown.match(/^---\n[\s\S]*?\n---\n?/);
	return match ? markdown.slice(match[0].length) : markdown;
}

/** 最初の見出し */
export function wikiTitle(markdown: string): string | undefined {
	const match = markdown.match(/^#\s+(?<title>.+)$/m);
	return match?.groups?.title.trim();
}

/**
 * 内部向けの区画を伏せる。
 *
 * ```
 * <!-- internal -->
 * ここは社内 Wiki には出さない
 * <!-- /internal -->
 * ```
 *
 * **消した跡は残す。** 黙って消すと、読む人は「そこに何かあった」ことすら分からない。
 */
export function redactInternal(markdown: string): { markdown: string; count: number } {
	let count = 0;
	const result = markdown.replace(/<!--\s*internal\s*-->[\s\S]*?<!--\s*\/internal\s*-->\n?/g, () => {
		count++;
		return '> （社内向けの記述をここから外しています）\n';
	});
	return { markdown: result, count };
}

/** `a/b/../c.md` → `a/c.md` */
function normalize(path: string): string {
	const parts: string[] = [];
	for (const part of path.split('/')) {
		if (part === '.' || part === '') {
			continue;
		}
		if (part === '..') {
			parts.pop();
			continue;
		}
		parts.push(part);
	}
	return parts.join('/');
}

const LINK = /(?<image>!?)\[(?<text>[^\]]*)\]\((?<href>[^)\s]+)(?<title>\s+"[^"]*")?\)/g;

/**
 * 相対リンクを絶対 URL に直す。
 *
 * リポジトリの URL が分からなければ**書き換えない**（間違った行き先を作るより、
 * 直せなかったと言うほうがよい）。`#見出し` は同じページの中なのでそのまま。
 */
export function resolveLinks(
	markdown: string,
	options: WikiOptions
): { markdown: string; resolved: number; unresolved: string[] } {
	const base = options.basePath ? options.basePath.split('/').slice(0, -1).join('/') : '';
	const ref = options.ref ?? 'main';
	let resolved = 0;
	const unresolved: string[] = [];

	const result = markdown.replace(LINK, (whole, image: string, text: string, href: string, title?: string) => {
		if (/^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(href)) {
			return whole;
		}
		if (!options.repoUrl) {
			unresolved.push(href);
			return whole;
		}
		const [path, anchor] = href.split('#');
		const full = normalize(base.length > 0 ? `${base}/${path}` : path);
		// 画像は raw、それ以外は blob（Wiki 側で画像が出るように）
		const kind = image === '!' ? 'raw' : 'blob';
		const url = `${options.repoUrl.replace(/\/$/, '')}/${kind}/${ref}/${full}${anchor ? `#${anchor}` : ''}`;
		resolved++;
		return `${image}[${text}](${url}${title ?? ''})`;
	});
	return { markdown: result, resolved, unresolved };
}

/** 貼れる形に直す */
export function toWiki(markdown: string, options: WikiOptions = {}): WikiResult {
	const withoutFrontMatter = stripFrontMatter(markdown);
	const redacted = redactInternal(withoutFrontMatter);
	const linked = resolveLinks(redacted.markdown, options);
	return {
		title: wikiTitle(withoutFrontMatter),
		markdown: linked.markdown,
		resolvedLinks: linked.resolved,
		redactedBlocks: redacted.count,
		unresolved: [...new Set(linked.unresolved)].sort()
	};
}

/** 画面に出す要約 */
export function describeExport(result: WikiResult): string {
	const lines = [
		result.title ? `「${result.title}」を貼れる形にしました` : '貼れる形にしました',
		`  絶対 URL に直したリンク: ${result.resolvedLinks} 件`
	];
	if (result.redactedBlocks > 0) {
		lines.push(`  伏せた区画: ${result.redactedBlocks} 件`);
	}
	if (result.unresolved.length > 0) {
		lines.push(
			`  直せなかったリンク: ${result.unresolved.length} 件（リポジトリの URL が分かりません）`,
			...result.unresolved.slice(0, 5).map((href) => `    ${href}`)
		);
	}
	return lines.join('\n');
}

/**
 * `git remote get-url origin` の出力からブラウザで開ける URL を作る。
 *
 * SSH（`git@github.com:owner/repo.git`）と HTTPS の両方を読む。
 * **資格情報が混ざっていたら落とす**（`https://user:token@host/...` を貼らせない）。
 */
export function browseUrl(remote: string): string | undefined {
	const text = remote.trim();
	if (text.length === 0) {
		return undefined;
	}
	const ssh = text.match(/^(?:ssh:\/\/)?[\w.-]+@(?<host>[\w.-]+)[:/](?<path>.+?)(?:\.git)?$/);
	if (ssh?.groups) {
		return `https://${ssh.groups.host}/${ssh.groups.path}`;
	}
	const https = text.match(/^https?:\/\/(?:[^@/]*@)?(?<host>[\w.-]+)\/(?<path>.+?)(?:\.git)?$/);
	if (https?.groups) {
		return `https://${https.groups.host}/${https.groups.path}`;
	}
	return undefined;
}
