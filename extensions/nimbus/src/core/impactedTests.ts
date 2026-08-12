/**
 * 影響を受けるテストだけを選ぶ（tasks.md T-180）。
 *
 * 変更のたびに全テストを回すのは、遅いというより**確認が習慣にならない**のが問題。
 * 「この変更に関係するテストだけ」なら数秒で終わるので、直すたびに回せる。
 *
 * 関係の判定は言語サーバーの参照検索に任せる（`file_graph` と同じ考え方）。
 * ここに置くのは、集めた結果の絞り込みと見せ方だけ。
 */
import { isTestPath } from './changeStats';

export interface ImpactedTests {
	/** 走らせるテストファイル（絶対パス） */
	files: string[];
	/** 変更されたファイルのうち、依存するテストが見つからなかったもの */
	uncovered: string[];
}

/**
 * 変更されたファイルと、その参照元から「走らせるべきテスト」を決める。
 *
 * - 変更されたファイル自身がテストなら、それは必ず走らせる
 * - 実装ファイルは、**それを参照しているテスト**を走らせる
 * - どちらにも当たらない変更は `uncovered` に残す（黙って落とさない）
 */
export function selectImpactedTests(
	changed: readonly string[],
	dependentsOf: (file: string) => readonly string[]
): ImpactedTests {
	const files = new Set<string>();
	const uncovered: string[] = [];

	for (const file of changed) {
		if (isTestPath(file)) {
			files.add(file);
			continue;
		}
		const tests = dependentsOf(file).filter(isTestPath);
		if (tests.length === 0) {
			uncovered.push(file);
			continue;
		}
		for (const test of tests) {
			files.add(test);
		}
	}
	return { files: [...files].sort(), uncovered };
}

/** 選ばれた結果の説明。1 行目だけで状況が分かるようにする */
export function describeImpacted(impacted: ImpactedTests, displayPath: (file: string) => string): string {
	if (impacted.files.length === 0) {
		return '変更に関係するテストは見つかりませんでした。';
	}
	const head = `関係するテスト ${impacted.files.length} 件`;
	const lines = impacted.files.map((file) => `  ${displayPath(file)}`);
	if (impacted.uncovered.length > 0) {
		lines.push(`（テストが見つからなかった変更: ${impacted.uncovered.map(displayPath).join(', ')}）`);
	}
	return [head, ...lines].join('\n');
}
