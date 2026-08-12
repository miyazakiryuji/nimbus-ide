/**
 * Xcode のプロジェクトファイルの衝突を解く（tasks.md T-199）。
 *
 * `project.pbxproj` は「両側でファイルを足した」だけでも衝突する。中身は行の集まりなので、
 * **たいていは両方を残せば正しい**。それなのに手で直すと、括弧や `isa` の並びを崩して
 * Xcode が開かなくなる。壊しやすい割に、判断はほとんど機械的という場所。
 *
 * ここでは**安全に自動で解けるものだけ**を解く。1 つでも怪しい塊があれば、
 * ファイル全体を「手で直してください」に倒す（半端に直すのがいちばん危ない）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface ConflictBlock {
	/** `<<<<<<<` の行番号（0 始まり） */
	line: number;
	ours: string[];
	theirs: string[];
}

export interface ResolveResult {
	/** 解けた場合の中身 */
	content?: string;
	blocks: number;
	/** 自動で解けた塊の数 */
	resolved: number;
	/** なぜ解けなかったか（解けなかったときだけ） */
	reason?: string;
}

const START = /^<{7} /;
const MIDDLE = /^={7}$/;
const END = /^>{7} /;

/** 衝突の塊を取り出す */
export function parseConflicts(content: string): ConflictBlock[] {
	const lines = content.split('\n');
	const blocks: ConflictBlock[] = [];
	let start = -1;
	let middle = -1;

	for (let i = 0; i < lines.length; i++) {
		if (START.test(lines[i])) {
			start = i;
			middle = -1;
		} else if (MIDDLE.test(lines[i]) && start >= 0) {
			middle = i;
		} else if (END.test(lines[i]) && start >= 0 && middle > start) {
			blocks.push({
				line: start,
				ours: lines.slice(start + 1, middle),
				theirs: lines.slice(middle + 1, i)
			});
			start = -1;
			middle = -1;
		}
	}
	return blocks;
}

/** その行が「足しただけ」に見えるか（pbxproj の 1 エントリは 1 行に収まる） */
function isEntryLine(line: string): boolean {
	const text = line.trim();
	if (text.length === 0) {
		return true;
	}
	// 24 桁の 16 進 ID を持つ行が pbxproj のエントリ。括弧だけの行は構造なので触らない
	return /^[0-9A-F]{24}\b/.test(text) || /^[0-9A-F]{24}\s*\/\*/.test(text);
}

/**
 * 両側とも「エントリを足しただけ」なら、順序を保って両方残す。
 * 片方が消していたり、構造（括弧・`isa`）を触っていたら解かない。
 */
export function resolveBlock(block: ConflictBlock): string[] | undefined {
	const all = [...block.ours, ...block.theirs];
	if (all.length === 0 || !all.every(isEntryLine)) {
		return undefined;
	}
	// 同じ行は 1 つに畳む（両側で同じファイルを足したとき）
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const line of all) {
		const key = line.trim();
		if (key.length > 0 && seen.has(key)) {
			continue;
		}
		seen.add(key);
		merged.push(line);
	}
	return merged;
}

/**
 * ファイル全体を解く。
 * **1 つでも解けない塊があれば、何も書き換えない。** 半端に直すのがいちばん危ない。
 */
export function resolvePbxproj(content: string): ResolveResult {
	const blocks = parseConflicts(content);
	if (blocks.length === 0) {
		return { blocks: 0, resolved: 0, reason: '衝突は見つかりませんでした' };
	}

	const lines = content.split('\n');
	const output: string[] = [];
	let cursor = 0;
	let resolved = 0;

	for (const block of blocks) {
		const merged = resolveBlock(block);
		if (!merged) {
			return {
				blocks: blocks.length,
				resolved: 0,
				reason: '構造そのもの（括弧や isa の並び）が両側で変わっています。手で直してください'
			};
		}
		output.push(...lines.slice(cursor, block.line));
		output.push(...merged);
		// `>>>>>>>` の次の行まで飛ばす
		const endLine = lines.findIndex((line, index) => index > block.line && END.test(line));
		cursor = endLine + 1;
		resolved++;
	}
	output.push(...lines.slice(cursor));

	return { content: output.join('\n'), blocks: blocks.length, resolved };
}

export function describeResult(result: ResolveResult): string {
	if (result.content) {
		return `${result.resolved} 件の衝突を、両方のエントリを残す形で解きました。Xcode で開いて確かめてください。`;
	}
	return result.reason ?? '解けませんでした';
}
