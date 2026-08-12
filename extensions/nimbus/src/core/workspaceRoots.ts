/**
 * 複数ルートのワークスペースで「どのフォルダの話か」を決める（tasks.md T-173）。
 *
 * 拡張のあちこちが `workspaceFolders[0]` を前提にしていて、フォルダを 2 つ開くと
 * **黙って 1 つ目だけを見る**。git の差分もテストもカバレッジも、全部そうなる。
 *
 * ここに置くのは判断だけ（VS Code に依存しない）。実際に選ばせる口は `workspaceRoots.ts`。
 */

export interface RootLike {
	/** 表示名 */
	name: string;
	/** 絶対パス */
	path: string;
}

/**
 * 手がかり（いま開いているファイルなど）から、どのルートの話かを決める。
 *
 * **いちばん深く一致するもの**を選ぶ。ルートが入れ子になっている構成
 * （モノレポの根と、その中のパッケージを両方開いている）でも、近い方が当たる。
 */
export function rootFor(roots: readonly RootLike[], filePath: string | undefined): RootLike | undefined {
	if (roots.length === 0) {
		return undefined;
	}
	if (roots.length === 1 || !filePath) {
		return roots[0];
	}
	const inside = roots
		.filter((root) => filePath === root.path || filePath.startsWith(`${root.path}/`))
		.sort((a, b) => b.path.length - a.path.length);
	return inside[0];
}

/**
 * 聞く必要があるか。
 * **フォルダが 1 つなら聞かない。** 手がかりで決まるなら聞かない。
 * コミット前や競合の最中に毎回ダイアログが出ると、道具として使えなくなる。
 */
export function needsPicking(roots: readonly RootLike[], filePath: string | undefined): boolean {
	return roots.length > 1 && rootFor(roots, filePath) === undefined;
}
