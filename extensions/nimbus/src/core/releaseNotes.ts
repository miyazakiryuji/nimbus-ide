/**
 * リリースノートの下書きを差分から作る（tasks.md T-062）。
 *
 * リリースのたびに「何を入れたっけ」とログを遡るのが毎回発生する。コミットは残っているので、
 * **人が読む形に並べ替えるところまで**を機械にやらせる。文章を書くのは人（または本文を
 * セッションに渡す）。ここは事実を落とさず並べることに徹する。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Commit {
	hash: string;
	subject: string;
}

export type ChangeGroup = 'feature' | 'fix' | 'docs' | 'other';

export interface GroupedChange {
	group: ChangeGroup;
	subject: string;
	hash: string;
	/** 件名や本文から拾ったタスク ID（`T-123`） */
	taskIds: string[];
}

/** `<hash>\t<subject>` の並びを読む（`git log --format=%h%x09%s` の出力） */
export function parseCommitLog(text: string): Commit[] {
	const commits: Commit[] = [];
	for (const line of text.split('\n')) {
		const at = line.indexOf('\t');
		if (at <= 0) {
			continue;
		}
		const subject = line.slice(at + 1).trim();
		if (subject.length === 0) {
			continue;
		}
		commits.push({ hash: line.slice(0, at).trim(), subject });
	}
	return commits;
}

/** 件名からタスク ID を拾う。同じものは 1 度だけ */
export function taskIdsIn(subject: string): string[] {
	return [...new Set(subject.match(/T-\d{3}/g) ?? [])];
}

/**
 * 分類する。
 *
 * 接頭辞（`docs:` など）が付いていればそれに従い、無ければ動詞で見る。
 * **迷ったら「その他」に落とす。**間違った分類で並べるより、分類しないほうが読み手を惑わせない。
 */
export function classifyCommit(subject: string): ChangeGroup {
	const lower = subject.toLowerCase();
	if (/^(docs|doc)[:(]/.test(lower) || /ドキュメント|仕様|記録|台帳/.test(subject)) {
		return 'docs';
	}
	if (/^(fix|bugfix)[:(]/.test(lower) || /直す|修復|バグ|落ちる|壊れ/.test(subject)) {
		return 'fix';
	}
	// 「〜できるようにする」「〜開けるようにする」のような言い回しが Nimbus のコミットでは多い
	if (
		/^(feat|feature)[:(]/.test(lower) ||
		/足す|作る|加える|追加|対応|見せる|開く|ように(する|なる)/.test(subject)
	) {
		return 'feature';
	}
	return 'other';
}

export function groupCommits(commits: readonly Commit[]): GroupedChange[] {
	return commits.map((commit) => ({
		group: classifyCommit(commit.subject),
		subject: commit.subject,
		hash: commit.hash,
		taskIds: taskIdsIn(commit.subject)
	}));
}

const GROUP_TITLE: Record<ChangeGroup, string> = {
	feature: '足したもの',
	fix: '直したもの',
	docs: 'ドキュメント',
	other: 'そのほか'
};

const GROUP_ORDER: ChangeGroup[] = ['feature', 'fix', 'docs', 'other'];

/**
 * Markdown にする。
 * **件名をそのまま載せる。**要約して事実が落ちるより、多少長くても原文のほうがいい。
 */
export function renderReleaseNotes(changes: readonly GroupedChange[], from: string, to: string): string {
	const lines = [`# リリースノート（下書き）`, '', `- 範囲: \`${from}\` → \`${to}\``, `- コミット数: **${changes.length}**`, ''];

	if (changes.length === 0) {
		lines.push('この範囲にコミットがありません。');
		return lines.join('\n') + '\n';
	}

	for (const group of GROUP_ORDER) {
		const rows = changes.filter((change) => change.group === group);
		if (rows.length === 0) {
			continue;
		}
		lines.push(`## ${GROUP_TITLE[group]}`, '');
		for (const row of rows) {
			// 件名に既に ID が書かれていることが多い。二重に出すと読みにくいので、無いときだけ添える
			const missing = row.taskIds.filter((id) => !row.subject.includes(id));
			const ids = missing.length > 0 ? `（${missing.join(' / ')}）` : '';
			lines.push(`- ${row.subject}${ids} \`${row.hash}\``);
		}
		lines.push('');
	}

	lines.push('---', '', '下書きです。**利用者から見て何が変わったか**の言葉に直してから配ってください。');
	return lines.join('\n') + '\n';
}
