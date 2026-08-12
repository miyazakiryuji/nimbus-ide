/**
 * モバイル（iOS / Android）の提出前チェック
 * （tasks.md T-196 権限の差分警告 / T-197 プライバシーマニフェスト / T-201 提出前チェックリスト）。
 *
 * 権限とプライバシーは、**足したことに気づかないまま出すと審査で落ちる**うえ、
 * 落ちたときの手戻りが大きい。差分の中でも特に目立たせる価値がある。
 *
 * 判定は「ファイルの中身から機械的に分かること」だけ。審査に通るかは判定しない
 * （それは Apple / Google が決めることで、ここで断言すると嘘になる）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface PermissionChange {
	key: string;
	kind: 'added' | 'removed' | 'emptied';
	/** その権限が何のためか（`Info.plist` の説明文） */
	description?: string;
}

/** `Info.plist` から `NS…UsageDescription` を取り出す（XML パーサは持ち込まない） */
export function parseUsageDescriptions(plist: string): Map<string, string> {
	const found = new Map<string, string>();
	const pattern = /<key>\s*(NS[A-Za-z]*UsageDescription)\s*<\/key>\s*<string>([\s\S]*?)<\/string>/g;
	for (const match of plist.matchAll(pattern)) {
		found.set(match[1], match[2].trim());
	}
	return found;
}

/**
 * 権限の増減を見る。
 *
 * **説明文が空になった**のも拾う（キーはあるが中身が無いと審査で弾かれる）。
 */
export function diffPermissions(before: string, after: string): PermissionChange[] {
	const oldKeys = parseUsageDescriptions(before);
	const newKeys = parseUsageDescriptions(after);
	const changes: PermissionChange[] = [];

	for (const [key, description] of newKeys) {
		if (!oldKeys.has(key)) {
			changes.push({ key, kind: 'added', description });
		} else if (description.length === 0 && (oldKeys.get(key) ?? '').length > 0) {
			changes.push({ key, kind: 'emptied' });
		}
	}
	for (const key of oldKeys.keys()) {
		if (!newKeys.has(key)) {
			changes.push({ key, kind: 'removed' });
		}
	}
	return changes.sort((a, b) => a.key.localeCompare(b.key));
}

export interface SubmissionFacts {
	/** `Info.plist` の中身（あれば） */
	plist?: string;
	/** `PrivacyInfo.xcprivacy` があるか */
	hasPrivacyManifest: boolean;
	/** `pubspec.yaml` の `version:` の値 */
	version?: string;
	/** 直近のリリースで使われた版（分かるとき） */
	lastReleasedVersion?: string;
}

export interface SubmissionCheck {
	title: string;
	ok: boolean;
	/** なぜ駄目か、どうすればいいか */
	note?: string;
}

/**
 * 提出前に機械で確かめられること。
 *
 * **審査に通るかは判定しない。**「これは確かめた」と言える項目を並べるだけ。
 */
export function checkSubmission(facts: SubmissionFacts): SubmissionCheck[] {
	const checks: SubmissionCheck[] = [];

	const descriptions = facts.plist ? parseUsageDescriptions(facts.plist) : new Map<string, string>();
	const empty = [...descriptions.entries()].filter(([, value]) => value.length === 0).map(([key]) => key);
	checks.push({
		title: '権限の説明文がすべて書かれている',
		ok: empty.length === 0,
		note: empty.length > 0 ? `空のもの: ${empty.join(' / ')}。空だと審査で弾かれます` : undefined
	});

	checks.push({
		title: 'プライバシーマニフェスト（PrivacyInfo.xcprivacy）がある',
		ok: facts.hasPrivacyManifest,
		note: facts.hasPrivacyManifest ? undefined : 'iOS では必要になる場合があります。使っている API と理由を書きます'
	});

	const bumped = Boolean(facts.version && facts.lastReleasedVersion && facts.version !== facts.lastReleasedVersion);
	checks.push({
		title: '版が前回の提出から上がっている',
		ok: facts.lastReleasedVersion ? bumped : Boolean(facts.version),
		note: facts.lastReleasedVersion && !bumped ? `\`${facts.version}\` のままです` : undefined
	});

	return checks;
}

export function renderMobileChecks(permissions: readonly PermissionChange[], checks: readonly SubmissionCheck[]): string {
	const lines = ['# 提出前の確認', ''];

	if (permissions.length > 0) {
		lines.push('## 権限が変わっています', '');
		for (const change of permissions) {
			if (change.kind === 'added') {
				lines.push(`- **増えました**: \`${change.key}\`${change.description ? ` — 「${change.description}」` : '（説明文が空です）'}`);
			} else if (change.kind === 'emptied') {
				lines.push(`- **説明文が空になりました**: \`${change.key}\` — 空だと審査で弾かれます`);
			} else {
				lines.push(`- 消えました: \`${change.key}\``);
			}
		}
		lines.push('', '権限は、足したことに気づかないまま出すと審査で落ちます。意図した変更か確かめてください。', '');
	}

	lines.push('## 機械で確かめられたこと', '');
	for (const check of checks) {
		lines.push(`- ${check.ok ? '✅' : '⚠️'} ${check.title}${check.note ? ` — ${check.note}` : ''}`);
	}
	lines.push('', '**審査に通るかどうかは判定していません。** ここに出ているのは、ファイルから分かることだけです。');

	return lines.join('\n') + '\n';
}
