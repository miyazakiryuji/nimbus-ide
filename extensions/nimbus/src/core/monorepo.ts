/**
 * モノレポのスコープ切り替え（tasks.md T-078）。
 *
 * パッケージが 30 個あるリポジトリで「全部を見せる」のは、見せていないのと同じ。
 * 探索に時間がかかり、関係ないファイルを読んで文脈を溶かし、
 * **別のパッケージを壊す**余地まで残る。
 *
 * 作業対象のパッケージだけをセッションの作業ディレクトリにすれば、そこが一度に片づく。
 *
 * VS Code に依存しない。マニフェストの場所からパッケージの根を割り出すところだけを置く。
 */

/** パッケージの目印になるファイル */
const MANIFESTS = [
	'package.json',
	'pubspec.yaml',
	'go.mod',
	'Cargo.toml',
	'pyproject.toml',
	'build.gradle',
	'build.gradle.kts',
	'pom.xml',
	'Package.swift',
	'composer.json',
	'Gemfile'
];

export interface PackageRoot {
	/** ワークスペースからの相対パス（根そのものは `.`） */
	path: string;
	/** 目印になったファイル */
	manifest: string;
}

/**
 * マニフェストのパス一覧から、パッケージの根を割り出す。
 * **同じディレクトリに複数のマニフェストがあっても 1 つに畳む**（Flutter は
 * `pubspec.yaml` と `build.gradle` が同居する）。
 */
export function findPackages(manifestPaths: readonly string[]): PackageRoot[] {
	const roots = new Map<string, string>();
	for (const path of manifestPaths) {
		const index = path.lastIndexOf('/');
		const directory = index < 0 ? '.' : path.slice(0, index);
		const manifest = index < 0 ? path : path.slice(index + 1);
		if (!MANIFESTS.includes(manifest)) {
			continue;
		}
		// 先に見つかった方を残す（一覧の順が優先順位）
		if (!roots.has(directory)) {
			roots.set(directory, manifest);
		}
	}
	return [...roots.entries()]
		.map(([path, manifest]) => ({ path, manifest }))
		.sort((a, b) => (a.path === '.' ? -1 : b.path === '.' ? 1 : a.path.localeCompare(b.path)));
}

/** いまのスコープの説明。`undefined` は「絞っていない」 */
export function describeScope(scope: string | undefined): string {
	return scope ? `作業対象: ${scope}` : '作業対象: リポジトリ全体';
}

/**
 * スコープを変えたときにセッションへ伝える文。
 * **既に走っているセッションには効かない**ことを隠さない — 次に始めるものから変わる。
 */
export function buildScopeNote(scope: string | undefined): string {
	return scope
		? `これからのセッションは ${scope} を作業ディレクトリにします（既に走っているセッションはそのままです）。`
		: '作業対象の絞り込みを解除しました。これからのセッションはリポジトリ全体を見ます。';
}
