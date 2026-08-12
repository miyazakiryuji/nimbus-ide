/**
 * 別のエージェントの結果と並べて比べる（tasks.md T-069）。
 *
 * Claude Code をメインに据えたうえで、別のツールにも同じ課題をやらせることがある。
 * そのとき困るのは「**どちらが良いか**」ではなく、「**どこが違うのか**」が分からないこと。
 * 2 つの差分を目で往復して比べるのは、それ自体が仕事になってしまう。
 *
 * ここでやるのは**違いの場所を出すところまで**。
 *
 * **どちらが良いかは言わない。** 良し悪しは、その課題で何を大事にしているかで決まる。
 * 機械が決められるのは「両方が同じ行を触った」という事実までで、そこから先は人が決める。
 *
 * VS Code に依存しない。
 */
import { parseAddedLines } from './coverage';

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface ChangedFile {
	path: string;
	status: ChangeStatus;
}

const STATUS: Record<string, ChangeStatus> = {
	A: 'added',
	M: 'modified',
	D: 'deleted',
	R: 'renamed'
};

/** `git diff --name-status` の出力を読む */
export function parseNameStatus(text: string): ChangedFile[] {
	const files: ChangedFile[] = [];
	for (const line of text.split('\n')) {
		const parts = line.split('\t').filter((part) => part.length > 0);
		if (parts.length < 2) {
			continue;
		}
		const status = STATUS[parts[0][0]];
		if (!status) {
			continue;
		}
		// 改名は `R100\told\tnew` の形。新しい方を見る
		files.push({ path: parts[parts.length - 1].trim(), status });
	}
	return files;
}

export interface Comparison {
	/** 両方が触ったファイル。**ここが選ぶ場所** */
	both: string[];
	/** 片方だけが触ったファイル */
	onlyA: string[];
	onlyB: string[];
}

/** 触った場所を突き合わせる */
export function compareChanges(a: readonly ChangedFile[], b: readonly ChangedFile[]): Comparison {
	const pathsA = new Set(a.map((file) => file.path));
	const pathsB = new Set(b.map((file) => file.path));
	return {
		both: [...pathsA].filter((path) => pathsB.has(path)).sort(),
		onlyA: [...pathsA].filter((path) => !pathsB.has(path)).sort(),
		onlyB: [...pathsB].filter((path) => !pathsA.has(path)).sort()
	};
}

export interface Overlap {
	file: string;
	/** 両方が足した行の数（1 起点の行番号で重なったもの） */
	sharedLines: number;
	linesA: number;
	linesB: number;
}

/**
 * 同じファイルの**同じ行**を両方が触ったか。
 *
 * ファイルが同じでも、離れた場所を直しているなら両方を採れる。
 * **同じ行を触っているところだけが、片方を捨てる判断の要る場所。**
 *
 * 差分は `git diff -U0` で渡す（`parseAddedLines` と同じ前提）。
 */
export function overlappingLines(diffA: string, diffB: string): Overlap[] {
	const addedA = parseAddedLines(diffA);
	const addedB = parseAddedLines(diffB);
	const overlaps: Overlap[] = [];
	for (const [file, linesA] of addedA) {
		const linesB = addedB.get(file);
		if (!linesB) {
			continue;
		}
		const setB = new Set(linesB);
		const shared = linesA.filter((line) => setB.has(line)).length;
		overlaps.push({ file, sharedLines: shared, linesA: linesA.length, linesB: linesB.length });
	}
	return overlaps.sort((x, y) => y.sharedLines - x.sharedLines || x.file.localeCompare(y.file));
}

/** 判断が要る場所（同じ行を両方が触ったファイル） */
export function conflicting(overlaps: readonly Overlap[]): Overlap[] {
	return overlaps.filter((overlap) => overlap.sharedLines > 0);
}

/** 画面に出す一覧。**どちらが良いかは書かない** */
export function describeComparison(
	comparison: Comparison,
	overlaps: readonly Overlap[],
	nameA: string,
	nameB: string
): string {
	const shared = conflicting(overlaps);
	const lines = [
		`両方が触ったファイル ${comparison.both.length} 件（うち同じ行 ${shared.length} 件）`,
		`  ${nameA} だけ: ${comparison.onlyA.length} 件`,
		`  ${nameB} だけ: ${comparison.onlyB.length} 件`
	];
	for (const overlap of shared.slice(0, 10)) {
		lines.push(`  同じ行: ${overlap.file}（${overlap.sharedLines} 行）`);
	}
	if (shared.length > 10) {
		lines.push(`  …他 ${shared.length - 10} 件`);
	}
	return lines.join('\n');
}

/**
 * セッションへ投入する文。
 *
 * **どちらを採るかは聞かない。** 聞けば必ずどちらかを答えるが、
 * それは根拠のある選択ではなく、聞かれたから出た答えになる。
 * 聞くのは「**それぞれが何をしているか**」と「**両立するか**」。
 */
export function buildComparePrompt(
	comparison: Comparison,
	overlaps: readonly Overlap[],
	nameA: string,
	nameB: string
): string {
	const shared = conflicting(overlaps);
	if (comparison.both.length === 0 && comparison.onlyA.length === 0 && comparison.onlyB.length === 0) {
		return '';
	}
	const lines = [
		`同じ課題に 2 つの変更（**${nameA}** と **${nameB}**）があります。**違いを整理してください。**`,
		''
	];
	if (shared.length > 0) {
		lines.push(
			'**同じ行を両方が触っているファイル**（ここは片方を選ぶ必要があります）:',
			'',
			...shared.map((overlap) => `- ${overlap.file}（重なり ${overlap.sharedLines} 行）`),
			''
		);
	}
	if (comparison.onlyA.length > 0) {
		lines.push(`**${nameA} だけが触ったファイル**:`, '', ...comparison.onlyA.map((path) => `- ${path}`), '');
	}
	if (comparison.onlyB.length > 0) {
		lines.push(`**${nameB} だけが触ったファイル**:`, '', ...comparison.onlyB.map((path) => `- ${path}`), '');
	}
	lines.push(
		'知りたいこと:',
		'',
		'1. それぞれが**何をしているか**（やり方の違い。良し悪しではありません）',
		'2. **両立するか** — 片方だけが触ったファイルは、そのまま両方採れますか',
		'3. 同じ行を触っている場所で、**選ぶときに効く違い**は何ですか',
		'',
		'**どちらが良いかは書かないでください。** それは、この課題で何を大事にしているかで決まります。'
	);
	return lines.join('\n');
}
