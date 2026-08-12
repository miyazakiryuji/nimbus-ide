/**
 * ロックファイルの差分を読める形にする（tasks.md T-119）。
 *
 * `pubspec.lock` や `package-lock.json` の差分は、行数ばかり多くて「何がなぜ上がったのか」が
 * 読み取れない。レビューで飛ばされる差分の代表格で、**飛ばされた結果いちばん壊れる**場所でもある。
 *
 * ここでは版の対応表に落として「何が・どこから・どこへ・どの段階で」上がったかだけを出す。
 * VS Code に依存しないので単体で検証できる。
 */

export type BumpKind = 'major' | 'minor' | 'patch' | 'other';

export interface VersionChange {
	name: string;
	from: string;
	to: string;
	kind: BumpKind;
}

export interface LockDiff {
	added: { name: string; version: string }[];
	removed: { name: string; version: string }[];
	changed: VersionChange[];
}

/** `pubspec.lock`（Dart / Flutter）から「名前 → 版」を取り出す */
export function parsePubspecLock(text: string): Map<string, string> {
	const versions = new Map<string, string>();
	let current: string | undefined;
	let inPackages = false;
	for (const line of text.split('\n')) {
		if (/^packages:/.test(line)) {
			inPackages = true;
			continue;
		}
		if (inPackages && /^\S/.test(line)) {
			// packages: の兄弟キー（sdks: など）に入ったら終わり
			inPackages = false;
		}
		if (!inPackages) {
			continue;
		}
		const name = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
		if (name) {
			current = name[1];
			continue;
		}
		const version = /^\s+version:\s*"?([^"\s]+)"?\s*$/.exec(line);
		if (version && current) {
			versions.set(current, version[1]);
			current = undefined;
		}
	}
	return versions;
}

/** `package-lock.json`（npm v2 以降）から「名前 → 版」を取り出す */
export function parsePackageLock(text: string): Map<string, string> {
	const versions = new Map<string, string>();
	let json: { packages?: Record<string, { version?: string }>; dependencies?: Record<string, { version?: string }> };
	try {
		json = JSON.parse(text);
	} catch {
		return versions;
	}
	for (const [path, entry] of Object.entries(json.packages ?? {})) {
		if (path === '' || !entry?.version) {
			continue;
		}
		// "node_modules/@scope/name" → "@scope/name"
		const at = path.lastIndexOf('node_modules/');
		versions.set(at >= 0 ? path.slice(at + 'node_modules/'.length) : path, entry.version);
	}
	for (const [name, entry] of Object.entries(json.dependencies ?? {})) {
		if (entry?.version && !versions.has(name)) {
			versions.set(name, entry.version);
		}
	}
	return versions;
}

/** 拡張子から読み手を選ぶ。知らない形式は空を返す（黙って壊れないように） */
export function parseLock(fileName: string, text: string): Map<string, string> {
	if (fileName.endsWith('pubspec.lock')) {
		return parsePubspecLock(text);
	}
	if (fileName.endsWith('package-lock.json')) {
		return parsePackageLock(text);
	}
	return new Map();
}

/** 版の上がり方。数字で始まらないものは判定しない（`git`・`path` 依存など） */
export function bumpKind(from: string, to: string): BumpKind {
	const a = /^(\d+)\.(\d+)\.(\d+)/.exec(from);
	const b = /^(\d+)\.(\d+)\.(\d+)/.exec(to);
	if (!a || !b) {
		return 'other';
	}
	if (a[1] !== b[1]) {
		return 'major';
	}
	if (a[2] !== b[2]) {
		return 'minor';
	}
	if (a[3] !== b[3]) {
		return 'patch';
	}
	return 'other';
}

export function diffLocks(before: Map<string, string>, after: Map<string, string>): LockDiff {
	const added: { name: string; version: string }[] = [];
	const removed: { name: string; version: string }[] = [];
	const changed: VersionChange[] = [];

	for (const [name, to] of after) {
		const from = before.get(name);
		if (from === undefined) {
			added.push({ name, version: to });
		} else if (from !== to) {
			changed.push({ name, from, to, kind: bumpKind(from, to) });
		}
	}
	for (const [name, version] of before) {
		if (!after.has(name)) {
			removed.push({ name, version });
		}
	}

	const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);
	// 壊れやすい順に並べる。major が埋もれると意味がない
	const order: Record<BumpKind, number> = { major: 0, minor: 1, patch: 2, other: 3 };
	return {
		added: added.sort(byName),
		removed: removed.sort(byName),
		changed: changed.sort((a, b) => order[a.kind] - order[b.kind] || byName(a, b))
	};
}

const KIND_LABEL: Record<BumpKind, string> = {
	major: 'メジャー（壊れる変更が入りうる）',
	minor: 'マイナー（機能追加）',
	patch: 'パッチ（修正）',
	other: 'その他'
};

/** 読める形にする。数を数えるだけでなく、**先に見るべきもの**が上に来るようにする */
export function renderLockDiff(diff: LockDiff, fileName: string): string {
	const lines = [`# ${fileName} の変更`, ''];
	const major = diff.changed.filter((c) => c.kind === 'major');

	if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
		lines.push('版の変化はありません（並び順や整形だけの差分です）。');
		return lines.join('\n') + '\n';
	}

	lines.push(
		`- 上がった: **${diff.changed.length}**（うちメジャー **${major.length}**）`,
		`- 増えた: **${diff.added.length}** / 消えた: **${diff.removed.length}**`,
		''
	);

	if (major.length > 0) {
		lines.push('## 先に見るべきもの（メジャー更新）', '');
		for (const change of major) {
			lines.push(`- **${change.name}** \`${change.from}\` → \`${change.to}\``);
		}
		lines.push('');
	}

	const rest = diff.changed.filter((c) => c.kind !== 'major');
	if (rest.length > 0) {
		lines.push('## そのほかの更新', '');
		for (const change of rest) {
			lines.push(`- ${change.name} \`${change.from}\` → \`${change.to}\`（${KIND_LABEL[change.kind]}）`);
		}
		lines.push('');
	}

	if (diff.added.length > 0) {
		lines.push('## 増えたもの', '', ...diff.added.map((a) => `- ${a.name} \`${a.version}\``), '');
	}
	if (diff.removed.length > 0) {
		lines.push('## 消えたもの', '', ...diff.removed.map((r) => `- ${r.name} \`${r.version}\``), '');
	}

	return lines.join('\n');
}
