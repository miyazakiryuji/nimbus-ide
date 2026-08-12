/**
 * 裏取りモード（tasks.md T-083）。
 *
 * ハルシネーションでいちばん多いのは「**そのライブラリの、そのバージョンには無い API**」を
 * 書いてしまうこと。学習時点の記憶で書くと、メジャーバージョンが変わっていても気づけない。
 *
 * 防ぐ材料は手元にある — `package.json` や `pubspec.yaml` に**実際に使っているバージョン**が
 * 書いてある。指示で名前が出たライブラリについて、そのバージョンを添えるだけで事故は減る。
 *
 * VS Code に依存しない。
 */

export interface Dependency {
	name: string;
	/** マニフェストに書かれている指定（`^18.3.1` など。解決後の版ではない） */
	version: string;
}

/** `package.json` の dependencies / devDependencies */
export function parsePackageJson(text: string): Dependency[] {
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		const found: Dependency[] = [];
		for (const key of ['dependencies', 'devDependencies', 'peerDependencies']) {
			const section = parsed[key];
			if (typeof section !== 'object' || section === null) {
				continue;
			}
			for (const [name, version] of Object.entries(section as Record<string, unknown>)) {
				if (typeof version === 'string' && !found.some((entry) => entry.name === name)) {
					found.push({ name, version });
				}
			}
		}
		return found;
	} catch {
		return [];
	}
}

/** `pubspec.yaml` の dependencies / dev_dependencies（YAML パーサは持ち込まない） */
export function parsePubspec(text: string): Dependency[] {
	const found: Dependency[] = [];
	let inside = false;
	for (const line of text.split('\n')) {
		if (/^(dependencies|dev_dependencies):/.test(line)) {
			inside = true;
			continue;
		}
		if (/^\S/.test(line)) {
			inside = false;
			continue;
		}
		if (!inside) {
			continue;
		}
		// `  provider: ^6.1.0` の形だけを拾う（`sdk:` のような入れ子は飛ばす）
		const match = /^\s{2}([a-zA-Z_][\w-]*):\s*(\S.*)$/.exec(line);
		if (match && !found.some((entry) => entry.name === match[1])) {
			found.push({ name: match[1], version: match[2].trim() });
		}
	}
	return found;
}

/** `go.mod` の require */
export function parseGoMod(text: string): Dependency[] {
	const found: Dependency[] = [];
	for (const line of text.split('\n')) {
		const match = /^\s*(?:require\s+)?([\w.\-/]+\.[\w.\-/]+)\s+(v\S+)/.exec(line);
		if (match && !found.some((entry) => entry.name === match[1])) {
			found.push({ name: match[1], version: match[2] });
		}
	}
	return found;
}

/**
 * 指示の中で名前が出ているライブラリ。
 * **短い名前で誤爆しない**よう、語として現れているものだけを拾う。
 */
export function mentionedDependencies(
	text: string,
	dependencies: readonly Dependency[],
	limit = 5
): Dependency[] {
	const found: Dependency[] = [];
	for (const dependency of dependencies) {
		if (dependency.name.length < 3) {
			continue;
		}
		// `@scope/name` や `package:foo/bar` の形でも当たるように、最後の要素でも見る。
		// ただし短すぎる別名（`ui` など）は誤爆するので、full name だけで見る
		const short = dependency.name.split('/').pop() ?? dependency.name;
		const forms = short.length >= 3 && short !== dependency.name ? [dependency.name, short] : [dependency.name];
		const pattern = new RegExp(`(^|[^\\w@/-])(${forms.map(escape).join('|')})([^\\w-]|$)`);
		if (pattern.test(text)) {
			found.push(dependency);
			if (found.length >= limit) {
				break;
			}
		}
	}
	return found;
}

function escape(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 指示に添える文。
 * **記憶ではなく実物で確かめさせる**のが目的なので、バージョンを名指しする。
 */
export function buildGroundingNote(matched: readonly Dependency[]): string {
	if (matched.length === 0) {
		return '';
	}
	return [
		'（Nimbus が添付したバージョン情報。**記憶ではなく、このバージョンの API で書いてください**）',
		...matched.map((entry) => `- ${entry.name}: ${entry.version}`),
		'自信が持てない API は、書く前に型定義か公式ドキュメントで確かめてください。'
	].join('\n');
}
