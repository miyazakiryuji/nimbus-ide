/**
 * 依存の食い違いを見つける（tasks.md T-198）。
 *
 * Flutter では「`pubspec.yaml` を触ったのに `pub get` していない」「プラグインを足したのに
 * `pod install` していない」が定番の詰まりどころ。**エラーメッセージが原因を指さない**ので、
 * 気づくまでに時間を溶かす。ファイルを突き合わせれば分かることなので、先に見せる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface DepFinding {
	kind: 'missing-in-lock' | 'stale-pods' | 'orphan-pod';
	name: string;
	hint: string;
}

/** `pubspec.yaml` の `dependencies:` / `dev_dependencies:` に並ぶ名前 */
export function parsePubspecDeps(yaml: string): string[] {
	const names: string[] = [];
	let inDeps = false;
	for (const line of yaml.split('\n')) {
		if (/^(dependencies|dev_dependencies):\s*$/.test(line)) {
			inDeps = true;
			continue;
		}
		if (/^\S/.test(line)) {
			inDeps = false;
		}
		if (!inDeps) {
			continue;
		}
		const match = /^ {2}([A-Za-z0-9_]+):/.exec(line);
		if (match && match[1] !== 'sdk' && match[1] !== 'flutter') {
			names.push(match[1]);
		}
	}
	return names;
}

/** `Podfile.lock` の `PODS:` に並ぶ名前（版とサブスペックは落とす） */
export function parsePodfileLock(text: string): string[] {
	const names: string[] = [];
	let inPods = false;
	for (const line of text.split('\n')) {
		if (/^PODS:\s*$/.test(line)) {
			inPods = true;
			continue;
		}
		if (/^\S/.test(line)) {
			inPods = false;
		}
		if (!inPods) {
			continue;
		}
		const match = /^\s{2}-\s+([A-Za-z0-9_+.-]+)/.exec(line);
		if (match) {
			names.push(match[1]);
		}
	}
	return [...new Set(names)];
}

/** 名前を突き合わせるための正規化（`url_launcher_ios` と `url_launcher` を寄せる） */
function normalize(name: string): string {
	return name.toLowerCase().replace(/[_-]/g, '').replace(/(ios|android|web|macos|windows|linux)$/, '');
}

export interface ConsistencyInput {
	pubspec?: string;
	pubspecLockNames?: readonly string[];
	podfileLock?: string;
	/** ネイティブ側を持つと分かっているパッケージ（プラグイン） */
	knownPlugins?: readonly string[];
}

/**
 * 食い違いを挙げる。
 *
 * **断定しない。**「〜かもしれません」ではなく「〜を実行すると揃います」と、
 * 次にやることを書く（原因の断定より、手が動くほうが役に立つ）。
 */
export function checkConsistency({ pubspec, pubspecLockNames, podfileLock, knownPlugins }: ConsistencyInput): DepFinding[] {
	const findings: DepFinding[] = [];

	if (pubspec && pubspecLockNames) {
		const locked = new Set(pubspecLockNames);
		for (const name of parsePubspecDeps(pubspec)) {
			if (!locked.has(name)) {
				findings.push({
					kind: 'missing-in-lock',
					name,
					hint: '`pubspec.yaml` にあるのに `pubspec.lock` にありません。`flutter pub get` を実行すると揃います'
				});
			}
		}
	}

	if (podfileLock && knownPlugins && knownPlugins.length > 0) {
		const pods = parsePodfileLock(podfileLock).map(normalize);
		for (const plugin of knownPlugins) {
			if (!pods.some((pod) => pod === normalize(plugin))) {
				findings.push({
					kind: 'stale-pods',
					name: plugin,
					hint: 'プラグインが `Podfile.lock` に入っていません。`ios` で `pod install` を実行すると揃います'
				});
			}
		}
	}

	return findings.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export function renderConsistency(findings: readonly DepFinding[]): string {
	if (findings.length === 0) {
		return '# 依存の食い違い\n\n食い違いは見つかりませんでした。\n';
	}
	const lines = ['# 依存の食い違い', '', `${findings.length} 件。**次にやることだけ書いてあります。**`, ''];
	for (const finding of findings) {
		lines.push(`- \`${finding.name}\` — ${finding.hint}`);
	}
	lines.push('', 'エラーメッセージが原因を指さない類のものなので、先に潰しておくと時間を節約できます。');
	return lines.join('\n') + '\n';
}
