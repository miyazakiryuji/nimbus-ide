/**
 * 変更のようすを数える（tasks.md T-159 差分の統計 / T-082 テスト無しコードへの警告）。
 *
 * 差分は「見た」つもりで見落とす。行数と触ったファイル数が分かるだけで、
 * レビューにかける時間の見積もりが変わる。あわせて、**テストが伴っていない変更**を静かに指摘する。
 * 止めはしない（テストを書けない事情はある）。気づける形にするだけ。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface FileChange {
	path: string;
	added: number;
	removed: number;
	/** テストのファイルか */
	isTest: boolean;
}

export interface ChangeStats {
	files: FileChange[];
	added: number;
	removed: number;
	/** テストが 1 つも変わっていないか */
	noTestChanges: boolean;
	/** 変更されたのにテストが伴っていない実装ファイル */
	untested: string[];
}

/** テストとして扱うパス。言語ごとの慣習をそのまま使う */
export function isTestPath(path: string): boolean {
	return (
		/(^|\/)(test|tests|spec|__tests__)\//.test(path) ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(path) ||
		/_test\.dart$/.test(path) ||
		/_test\.go$/.test(path) ||
		/Test\.java$/.test(path)
	);
}

/** ドキュメントや設定など、テストを求める意味が薄いもの */
function isNonCode(path: string): boolean {
	return /\.(md|json|ya?ml|txt|lock|svg|png|jpg|icns)$/.test(path) || /(^|\/)docs?\//.test(path);
}

/**
 * `git diff --numstat` の出力を読む。
 * バイナリは `-\t-\t<path>` で来るので 0 として扱う（数えられないものを数えたことにしない）。
 */
export function parseNumstat(text: string): FileChange[] {
	const files: FileChange[] = [];
	for (const line of text.split('\n')) {
		const parts = line.split('\t');
		if (parts.length < 3) {
			continue;
		}
		const [addedRaw, removedRaw, ...rest] = parts;
		const path = rest.join('\t').trim();
		if (path.length === 0) {
			continue;
		}
		files.push({
			path,
			added: addedRaw === '-' ? 0 : Number(addedRaw) || 0,
			removed: removedRaw === '-' ? 0 : Number(removedRaw) || 0,
			isTest: isTestPath(path)
		});
	}
	return files;
}

export function summarize(files: readonly FileChange[]): ChangeStats {
	const added = files.reduce((sum, file) => sum + file.added, 0);
	const removed = files.reduce((sum, file) => sum + file.removed, 0);
	const testFiles = files.filter((file) => file.isTest);
	const code = files.filter((file) => !file.isTest && !isNonCode(file.path));
	return {
		files: [...files].sort((a, b) => b.added + b.removed - (a.added + a.removed) || a.path.localeCompare(b.path)),
		added,
		removed,
		noTestChanges: code.length > 0 && testFiles.length === 0,
		untested: code.map((file) => file.path)
	};
}

/** 読める形にする。数字のあとに、気づいてほしいことを 1 つだけ添える */
export function renderChangeStats(stats: ChangeStats): string {
	const lines = ['# 変更のようす', ''];

	if (stats.files.length === 0) {
		lines.push('変更はありません。');
		return lines.join('\n') + '\n';
	}

	lines.push(
		`- 触ったファイル: **${stats.files.length}**`,
		`- 追加: **+${stats.added}** / 削除: **-${stats.removed}**`,
		''
	);

	lines.push('## ファイル', '');
	for (const file of stats.files) {
		const mark = file.isTest ? ' 〈テスト〉' : '';
		lines.push(`- \`${file.path}\` +${file.added} / -${file.removed}${mark}`);
	}
	lines.push('');

	if (stats.noTestChanges) {
		lines.push(
			'## テストが伴っていません',
			'',
			'実装だけが変わっていて、テストが 1 つも変わっていません。',
			'書けない事情があるならそれで構いませんが、**その理由を `tasks.md` に 1 行残してください**',
			'（README「実装したらテストも作る」）。対象:',
			''
		);
		for (const path of stats.untested.slice(0, 10)) {
			lines.push(`- \`${path}\``);
		}
		if (stats.untested.length > 10) {
			lines.push(`- …ほか ${stats.untested.length - 10} 件`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
