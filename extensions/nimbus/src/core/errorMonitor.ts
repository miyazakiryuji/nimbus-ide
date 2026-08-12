/**
 * エラー監視ツールとの連携（tasks.md T-142）。
 *
 * スタックトレースは「**どこで**落ちたか」しか言わない。監視ツール（Sentry など）は
 * それに加えて「**どれくらい効いているか**」と「**何をしたら落ちたか**」を持っている。
 *
 * - 件数・影響人数・初回/最終発生・リリース → **直す順番**を変える
 * - breadcrumbs（操作の足あと）→ **再現の入力そのもの**になる
 *
 * ここが扱うのはその 2 つ。スタックからテストを起こすところは `core/reproTest.ts`（T-143）、
 * 実機クラッシュのテキストは `core/crashLog.ts`（T-074）が持っている。**同じものを二度書かない。**
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 操作の足あと。Sentry の breadcrumbs */
export interface Breadcrumb {
	/** いつ（読めたときだけ） */
	at?: string;
	/** `navigation` / `ui.click` / `http` など */
	category?: string;
	message: string;
	level?: string;
}

export interface MonitoredIssue {
	title: string;
	/** 落ちた場所の目安（Sentry の culprit） */
	culprit?: string;
	/** 何回起きたか */
	count?: number;
	/** 何人に起きたか */
	userCount?: number;
	firstSeen?: string;
	lastSeen?: string;
	release?: string;
	environment?: string;
	breadcrumbs: Breadcrumb[];
	/** スタックとして読める部分。`core/reproTest.ts` へそのまま渡す */
	stackText?: string;
	/** 未解決か。解決済みのものを直しにいかないため */
	unresolved: boolean;
	permalink?: string;
}

/** 数として読めるものだけを返す。Sentry は件数を文字列で返すことがある */
export function asCount(value: unknown): number | undefined {
	const n = typeof value === 'string' ? Number(value) : value;
	return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined;
}

function str(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** breadcrumbs は `{values: [...]}` の形でも、素の配列でも来る */
function readBreadcrumbs(value: unknown): Breadcrumb[] {
	const wrapper = record(value);
	const list = Array.isArray(value) ? value : Array.isArray(wrapper?.['values']) ? (wrapper['values'] as unknown[]) : [];
	const crumbs: Breadcrumb[] = [];
	for (const item of list) {
		const entry = record(item);
		if (!entry) {
			continue;
		}
		// message が無いものは `data` から拾えることがある（http の url など）
		const data = record(entry['data']);
		const message =
			str(entry['message']) ?? str(data?.['url']) ?? str(entry['type']) ?? str(entry['category']);
		if (!message) {
			continue;
		}
		crumbs.push({
			at: str(entry['timestamp']),
			category: str(entry['category']),
			message,
			level: str(entry['level'])
		});
	}
	return crumbs;
}

/**
 * 監視ツールから貼られた JSON を読む。
 *
 * Sentry の issue / event どちらの形でも読めるようにしてある。
 * **読めなければ undefined。** 中途半端に読むと、件数や影響人数が嘘になる。
 */
export function parseMonitoredIssue(text: string): MonitoredIssue | undefined {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch {
		return undefined;
	}
	const root = record(json);
	if (!root) {
		return undefined;
	}
	const metadata = record(root['metadata']);
	// metadata からの組み立ては空文字になりうるので、`||` で次へ落とす。
	// `??` と混ぜると読みづらいうえ TS が拒むので、段を分ける
	const fromMetadata = [str(metadata?.['type']), str(metadata?.['value'])].filter(Boolean).join(': ');
	const title = str(root['title']) ?? (fromMetadata || str(root['message']));
	if (!title) {
		return undefined;
	}
	const tags = Array.isArray(root['tags']) ? (root['tags'] as unknown[]) : [];
	const tagValue = (key: string): string | undefined => {
		for (const item of tags) {
			const entry = record(item);
			if (entry && str(entry['key']) === key) {
				return str(entry['value']);
			}
		}
		return undefined;
	};

	return {
		title,
		culprit: str(root['culprit']),
		count: asCount(root['count']),
		userCount: asCount(root['userCount']) ?? asCount(root['user_count']),
		firstSeen: str(root['firstSeen']) ?? str(root['first_seen']),
		lastSeen: str(root['lastSeen']) ?? str(root['last_seen']),
		release: str(tagValue('release')) ?? str(record(root['release'])?.['version']),
		environment: str(tagValue('environment')) ?? str(root['environment']),
		breadcrumbs: readBreadcrumbs(root['breadcrumbs']),
		stackText: str(root['stackTrace']) ?? str(root['stacktrace']) ?? str(root['culprit']),
		// `status` が無いものは、解決済みと決めつけない
		unresolved: str(root['status']) !== 'resolved',
		permalink: str(root['permalink'])
	};
}

/** 「どれくらい効いているか」の 1 行。直す順番はここで決まる */
export function describeImpact(issue: MonitoredIssue): string {
	const parts: string[] = [];
	if (issue.count !== undefined) {
		parts.push(`${issue.count.toLocaleString('ja-JP')} 回`);
	}
	if (issue.userCount !== undefined) {
		parts.push(`${issue.userCount.toLocaleString('ja-JP')} 人`);
	}
	if (parts.length === 0) {
		return '影響の大きさは分かりません';
	}
	return parts.join(' / ');
}

/** 最後の足あとほど、落ちた瞬間に近い */
const MAX_CRUMBS = 12;

/**
 * 直す前に読ませるまとめ。
 * **「どれくらい効いているか」を最初に出す** — 直す順番を決めるのがここだから。
 */
export function formatIssue(issue: MonitoredIssue): string {
	const lines = [
		'# 監視ツールからの障害',
		'',
		`**${issue.title}**`,
		'',
		`影響: ${describeImpact(issue)}`
	];
	if (!issue.unresolved) {
		lines.push('', '> **これは解決済みとして記録されています。**直しにいく前に、本当にまだ起きているか確かめてください。');
	}
	const facts: string[] = [];
	if (issue.culprit) {
		facts.push(`- 場所の目安: \`${issue.culprit}\``);
	}
	if (issue.release) {
		facts.push(`- リリース: ${issue.release}`);
	}
	if (issue.environment) {
		facts.push(`- 環境: ${issue.environment}`);
	}
	if (issue.firstSeen) {
		facts.push(`- 初回: ${issue.firstSeen}`);
	}
	if (issue.lastSeen) {
		facts.push(`- 最終: ${issue.lastSeen}`);
	}
	if (issue.permalink) {
		facts.push(`- 元の記録: ${issue.permalink}`);
	}
	if (facts.length > 0) {
		lines.push('', ...facts);
	}

	if (issue.breadcrumbs.length > 0) {
		// 落ちた瞬間に近い順に読みたいので、後ろから
		const recent = issue.breadcrumbs.slice(-MAX_CRUMBS);
		lines.push(
			'',
			'## 落ちるまでの足あと',
			'',
			'**再現の入力はここから作れます。**スタックには無い情報なので、まずこれを読んでください。',
			''
		);
		if (issue.breadcrumbs.length > MAX_CRUMBS) {
			lines.push(`（古い ${issue.breadcrumbs.length - MAX_CRUMBS} 件は省略）`, '');
		}
		for (const crumb of recent) {
			const where = crumb.category ? `\`${crumb.category}\` ` : '';
			lines.push(`- ${where}${crumb.message}`);
		}
	} else {
		lines.push('', '足あと（breadcrumbs）は入っていませんでした。再現の手がかりはスタックだけです。');
	}

	lines.push(
		'',
		'## 先にやること',
		'',
		'**再現するテストを先に書いてください。**足あとがあるなら、それを順に辿るのが最短です。',
		'再現できないまま直すと、直ったかどうかを確かめる手立てがありません。',
		''
	);
	return lines.join('\n');
}

/** 直してもらう頼みかた。影響と足あとを添える */
export function fixPrompt(issue: MonitoredIssue): string {
	return [
		formatIssue(issue),
		'---',
		'',
		'この障害について、**まず再現するテスト**を書いてください。そのあとで直します。',
		'',
		'- 足あと（breadcrumbs）があるなら、それを順に辿ると再現の入力が作れます',
		'- 足あとから読み取れないところは、**推測で埋めずに「分からない」と書いてください**',
		''
	].join('\n');
}
