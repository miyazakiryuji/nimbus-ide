/**
 * `nimbus_git` の読み解きと安全装置（tasks.md T-307）。
 *
 * 素の `git` は Bash で打てるので、**ただのラッパーには価値が無い**（選ぶ基準 1）。
 * ここにあるのは Nimbus 側にしか無いものだけ:
 *
 * - **並行セッションの作法を型にする** — 状態は「自分が組んだ束」と「作業ツリー
 *   （他のセッションのものかもしれない）」を分けて返す。stage はパス名指しのみ
 * - `git add -A` / `commit -a` / `stash` / `checkout --` / `reset --hard` は**口に出さない**
 *
 * VS Code にも git にも依存しない（文字列を受け取り、構造で返す）。
 */

export interface RepoStatus {
	branch: string;
	upstream?: string;
	ahead: number;
	behind: number;
	/** index に組んである（自分がこれからコミットする束） */
	staged: string[];
	/** 作業ツリーの変更（**他のセッションのものかもしれない** — 触らない） */
	unstaged: string[];
	untracked: string[];
	/** 競合中 */
	conflicted: string[];
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** `git status --porcelain -b` を読む */
export function parsePorcelainStatus(text: string): RepoStatus {
	const status: RepoStatus = {
		branch: '(不明)',
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [],
		untracked: [],
		conflicted: []
	};
	for (const line of text.split('\n')) {
		if (line.startsWith('## ')) {
			const head = line.slice(3);
			const match = /^(?<branch>[^.]+?)(?:\.\.\.(?<upstream>\S+))?(?: \[(?<counts>[^\]]+)\])?$/.exec(head);
			if (match?.groups) {
				status.branch = match.groups['branch'];
				status.upstream = match.groups['upstream'];
				const counts = match.groups['counts'] ?? '';
				status.ahead = Number(/ahead (\d+)/.exec(counts)?.[1] ?? 0);
				status.behind = Number(/behind (\d+)/.exec(counts)?.[1] ?? 0);
			}
			continue;
		}
		if (line.length < 4) {
			continue;
		}
		const code = line.slice(0, 2);
		// リネームは `旧 -> 新` で来る。見せるのは新しいほう
		const rawPath = line.slice(3);
		const path = rawPath.includes(' -> ') ? rawPath.split(' -> ')[1] : rawPath;
		if (code === '??') {
			status.untracked.push(path);
		} else if (CONFLICT_CODES.has(code)) {
			status.conflicted.push(path);
		} else {
			if (code[0] !== ' ') {
				status.staged.push(path);
			}
			if (code[1] !== ' ') {
				status.unstaged.push(path);
			}
		}
	}
	return status;
}

/** エージェントに返す形。**誰のものか分からない変更に触らせない**ための言い分けをここでする */
export function renderStatus(status: RepoStatus): string {
	const lines: string[] = [];
	const tracking =
		status.upstream === undefined
			? '追跡先なし'
			: `追跡 ${status.upstream}（↑${status.ahead} ↓${status.behind}）`;
	lines.push(`ブランチ: ${status.branch} · ${tracking}`, '');
	const section = (title: string, entries: string[], note?: string): void => {
		lines.push(`## ${title}（${entries.length} 件）${note ? ` — ${note}` : ''}`);
		for (const entry of entries.slice(0, 50)) {
			lines.push(`- ${entry}`);
		}
		if (entries.length > 50) {
			lines.push(`- …ほか ${entries.length - 50} 件`);
		}
		lines.push('');
	};
	section('自分が組んだ束（staged）', status.staged, 'git_commit はこれをコミットする');
	section(
		'作業ツリーの変更（unstaged）',
		status.unstaged,
		'**他のセッションのものかもしれない。** 自分の変更だと分かるものだけ git_stage でパス名指しする'
	);
	section('追跡していないファイル', status.untracked);
	if (status.conflicted.length > 0) {
		section('競合中', status.conflicted, '解決するまで git_commit は使えない');
	}
	return lines.join('\n').trim();
}

/**
 * stage に渡せるパスか。**名指し以外を通さない**のがこの口の存在理由なので、
 * まとめ指定（`-A` / `.`）・範囲外・フラグに化けるものはすべて断る。
 */
export function validateStagePaths(paths: readonly string[]): { ok: string[] } | { error: string } {
	if (paths.length === 0) {
		return { error: 'パスを 1 つ以上、名指しで渡してください（まとめて全部、は受け付けません）。' };
	}
	for (const path of paths) {
		if (typeof path !== 'string' || path.trim().length === 0) {
			return { error: '空のパスがあります。' };
		}
		if (path === '.' || path === '-A' || path === '--all' || path === '*') {
			return { error: `「${path}」のようなまとめ指定は受け付けません。ファイルを名指ししてください（他のセッションの変更を巻き込むため）。` };
		}
		if (path.startsWith('-')) {
			return { error: `「${path}」はフラグに見えるため受け付けません。` };
		}
		if (path.startsWith('/') || path.includes('..')) {
			return { error: `「${path}」はリポジトリの外を指しうるため受け付けません（リポジトリからの相対パスで）。` };
		}
	}
	return { ok: [...paths] };
}
