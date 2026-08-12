/**
 * コードオーナーへの通知（tasks.md T-221）。
 *
 * 触ったファイルに持ち主がいるなら、**レビューを頼む前に誰に頼むかは決まっている**。
 * 探すのは人の仕事ではないし、`CODEOWNERS` を読み違えると別の人に投げてしまう。
 *
 * VS Code に依存しない。GitHub の `CODEOWNERS` の書式をそのまま読む。
 */

export interface OwnerRule {
	/** 元のパターン */
	pattern: string;
	owners: string[];
}

/** `CODEOWNERS` を読む。コメントと空行は落とす */
export function parseCodeowners(text: string): OwnerRule[] {
	const rules: OwnerRule[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.replace(/#.*$/, '').trim();
		if (line.length === 0) {
			continue;
		}
		const [pattern, ...owners] = line.split(/\s+/);
		if (!pattern || owners.length === 0) {
			continue;
		}
		rules.push({ pattern, owners });
	}
	return rules;
}

/** 1 つの区切り（`/` の間）を正規表現の断片にする */
function segmentToSource(segment: string): string {
	let source = '';
	for (let index = 0; index < segment.length; index++) {
		const character = segment[index];
		if (character === '*') {
			if (segment[index + 1] === '*') {
				source += '.*';
				index++;
			} else {
				source += '[^/]*';
			}
		} else if (character === '?') {
			source += '[^/]';
		} else if ('.+^${}()|[]\\'.includes(character)) {
			source += `\\${character}`;
		} else {
			source += character;
		}
	}
	return source;
}

/** `CODEOWNERS` のパターンを正規表現にする（gitignore と同じ考え方） */
function toRegExp(pattern: string): RegExp {
	let source = pattern;
	// 先頭の `/` はリポジトリの根から。無ければどこでも当たる
	const anchored = source.startsWith('/');
	if (anchored) {
		source = source.slice(1);
	}
	const directory = source.endsWith('/');
	if (directory) {
		source = source.slice(0, -1);
	}
	const body = source.split('/').map(segmentToSource).join('/');
	const head = anchored ? '^' : '(^|.*/)';
	const tail = directory ? '/.*$' : '(/.*)?$';
	return new RegExp(`${head}${body}${tail}`);
}

/**
 * そのファイルの持ち主。
 * **最後に一致した規則が勝つ**（GitHub の仕様）。当たらなければ持ち主なし。
 */
export function ownersFor(path: string, rules: readonly OwnerRule[]): string[] {
	let owners: string[] = [];
	for (const rule of rules) {
		if (toRegExp(rule.pattern).test(path)) {
			owners = rule.owners;
		}
	}
	return owners;
}

export interface OwnerSummary {
	owner: string;
	files: string[];
}

/** 触ったファイルを持ち主ごとにまとめる（多い順） */
export function summarizeOwners(
	files: readonly string[],
	rules: readonly OwnerRule[]
): { owners: OwnerSummary[]; unowned: string[] } {
	const byOwner = new Map<string, string[]>();
	const unowned: string[] = [];
	for (const file of files) {
		const owners = ownersFor(file, rules);
		if (owners.length === 0) {
			unowned.push(file);
			continue;
		}
		for (const owner of owners) {
			byOwner.set(owner, [...(byOwner.get(owner) ?? []), file]);
		}
	}
	return {
		owners: [...byOwner.entries()]
			.map(([owner, owned]) => ({ owner, files: owned.sort() }))
			.sort((a, b) => b.files.length - a.files.length || a.owner.localeCompare(b.owner)),
		unowned: unowned.sort()
	};
}

/** 画面に出す一覧 */
export function describeOwners(summary: {
	owners: readonly OwnerSummary[];
	unowned: readonly string[];
}): string {
	if (summary.owners.length === 0) {
		return '触ったファイルに持ち主はいません（CODEOWNERS に一致しません）。';
	}
	const lines = summary.owners.map((entry) => `  ${entry.owner}: ${entry.files.length} ファイル`);
	if (summary.unowned.length > 0) {
		lines.push(`  （持ち主なし: ${summary.unowned.length} ファイル）`);
	}
	return [`レビューを頼む相手 ${summary.owners.length} 人`, ...lines].join('\n');
}

/** PR の説明などに貼れる形 */
export function renderMentionBlock(summary: { owners: readonly OwnerSummary[] }): string {
	if (summary.owners.length === 0) {
		return '';
	}
	return [
		'レビューをお願いします（CODEOWNERS より）:',
		...summary.owners.map((entry) => `- ${entry.owner} — ${entry.files.slice(0, 5).join(', ')}${entry.files.length > 5 ? ` 他 ${entry.files.length - 5} 件` : ''}`)
	].join('\n');
}
