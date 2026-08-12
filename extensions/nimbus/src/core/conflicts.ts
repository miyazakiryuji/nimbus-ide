/**
 * コンフリクトの読み解きと解決（tasks.md T-115）。
 *
 * 競合の解決がつらいのは、`<<<<<<<` の左右を**目で見比べて意図を当てる**ところにある。
 * ここは機械で分かる部分だけを引き受ける — どこが競合しているか、両側が何行か、
 * そして「両方残す」「片方を採る」を**確実に**適用すること。
 *
 * この開発では複数の AI が 1 つのブランチを触るので、競合の大半は
 * **追記どうしのぶつかり**（`tasks.md` の行、`package.json` の `contributes`）になる。
 * その形はたいてい「両方残す」が正解なので、その選択肢を一等地に置いてある。
 *
 * **意図の読み取りはしない。** どちらを採るかは人（と Claude）が決める。
 * VS Code に依存しないので単体で検証できる（誤ると**変更が消える**場所なので必ずテストする）。
 */

export interface ConflictSide {
	/** マーカーに書かれていた名前（ブランチ名など） */
	label: string;
	lines: string[];
}

export interface ConflictBlock {
	/** ファイル内の開始行（0 始まり・`<<<<<<<` の行） */
	start: number;
	/** マーカーを含めた行数 */
	length: number;
	ours: ConflictSide;
	/** `diff3` 形式のときだけ入る（`merge.conflictStyle=diff3`） */
	base?: ConflictSide;
	theirs: ConflictSide;
}

/** 採りかた。`both` は「ours のあと theirs」＝追記どうしのぶつかりで使う */
export type Resolution = 'ours' | 'theirs' | 'both' | 'base';

const OURS = /^<{7}(?: (.*))?$/;
const BASE = /^\|{7}(?: (.*))?$/;
const SPLIT = /^={7}$/;
const THEIRS = /^>{7}(?: (.*))?$/;

export function hasConflictMarkers(text: string): boolean {
	return text.split('\n').some((line) => OURS.test(line));
}

/**
 * 競合部分を拾う。マーカーが閉じていないもの（壊れたファイル）は**採らない** —
 * 中途半端に解釈して書き戻すと、残っていた変更まで消える。
 */
export function parseConflicts(text: string): ConflictBlock[] {
	const lines = text.split('\n');
	const blocks: ConflictBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = OURS.exec(lines[i]);
		if (!open) {
			i++;
			continue;
		}
		const start = i;
		const ours: string[] = [];
		const baseLines: string[] = [];
		const theirs: string[] = [];
		let baseLabel: string | undefined;
		let stage: 'ours' | 'base' | 'theirs' = 'ours';
		let closed = false;
		let theirsLabel = '';
		let j = i + 1;
		for (; j < lines.length; j++) {
			const line = lines[j];
			const baseMark = BASE.exec(line);
			const theirsMark = THEIRS.exec(line);
			if (baseMark && stage === 'ours') {
				baseLabel = baseMark[1] ?? '';
				stage = 'base';
				continue;
			}
			if (SPLIT.test(line) && stage !== 'theirs') {
				stage = 'theirs';
				continue;
			}
			if (theirsMark) {
				theirsLabel = theirsMark[1] ?? '';
				closed = true;
				break;
			}
			// 入れ子のマーカーは扱わない（起きたら壊れたファイルとして飛ばす）
			if (OURS.test(line)) {
				break;
			}
			(stage === 'ours' ? ours : stage === 'base' ? baseLines : theirs).push(line);
		}
		if (!closed) {
			// 閉じていない。ここから先は解釈しない
			i = start + 1;
			continue;
		}
		blocks.push({
			start,
			length: j - start + 1,
			ours: { label: open[1] ?? '', lines: ours },
			base: baseLabel !== undefined ? { label: baseLabel, lines: baseLines } : undefined,
			theirs: { label: theirsLabel, lines: theirs }
		});
		i = j + 1;
	}
	return blocks;
}

function chosenLines(block: ConflictBlock, resolution: Resolution): string[] {
	switch (resolution) {
		case 'ours':
			return block.ours.lines;
		case 'theirs':
			return block.theirs.lines;
		case 'base':
			return block.base?.lines ?? [];
		case 'both':
			return [...block.ours.lines, ...block.theirs.lines];
	}
}

/**
 * 選んだとおりに書き戻す。
 * **選ばれなかった競合はマーカーごと残す** — 黙って片方を採ると変更が消える。
 *
 * @param choices 競合の番号（`parseConflicts` の順）→ 採りかた
 */
export function resolveConflicts(text: string, choices: ReadonlyMap<number, Resolution>): string {
	const blocks = parseConflicts(text);
	if (blocks.length === 0) {
		return text;
	}
	const lines = text.split('\n');
	const out: string[] = [];
	let cursor = 0;
	blocks.forEach((block, index) => {
		out.push(...lines.slice(cursor, block.start));
		const resolution = choices.get(index);
		if (resolution) {
			out.push(...chosenLines(block, resolution));
		} else {
			// 手つかずの競合はそのまま残す
			out.push(...lines.slice(block.start, block.start + block.length));
		}
		cursor = block.start + block.length;
	});
	out.push(...lines.slice(cursor));
	return out.join('\n');
}

/** 1 行の説明。「何行 対 何行」が分かれば、目で見る前に見当がつく */
export function describeConflict(block: ConflictBlock, index: number): string {
	const ours = block.ours.lines.length;
	const theirs = block.theirs.lines.length;
	return `${index + 1} 件目（${block.start + 1} 行目）: こちら ${ours} 行 ⇔ むこう ${theirs} 行`;
}

/**
 * 追記どうしのぶつかりに見えるか。
 *
 * 両側とも中身があって、**共通の行が無い**なら、片方を捨てる理由が無いことが多い
 * （`tasks.md` に別々の行を足した、`contributes` に別々のコマンドを足した、など）。
 * あくまで**目安**で、これを根拠に自動では決めない。
 */
export function looksAdditive(block: ConflictBlock): boolean {
	if (block.ours.lines.length === 0 || block.theirs.lines.length === 0) {
		return false;
	}
	const ours = new Set(block.ours.lines.map((line) => line.trim()).filter(Boolean));
	if (ours.size === 0) {
		return false;
	}
	return !block.theirs.lines.some((line) => line.trim() && ours.has(line.trim()));
}

/** Claude に渡す相談文。両側をそのまま見せて、**意図を残すマージ**を頼む */
export function conflictPrompt(path: string, blocks: readonly ConflictBlock[]): string {
	const parts = [
		`${path} で ${blocks.length} 件のコンフリクトが起きています。`,
		'',
		'**両方の変更の意図を汲んだ解決案**を出してください。片方を捨てる場合は理由も。',
		'追記どうしのぶつかりなら、両方を残すのが正しいことが多いです。',
		''
	];
	blocks.forEach((block, index) => {
		parts.push(
			`## ${index + 1} 件目（${block.start + 1} 行目）`,
			'',
			`### こちら（${block.ours.label || 'ours'}）`,
			'```',
			...block.ours.lines,
			'```',
			''
		);
		if (block.base) {
			parts.push(`### 分岐元（${block.base.label || 'base'}）`, '```', ...block.base.lines, '```', '');
		}
		parts.push(`### むこう（${block.theirs.label || 'theirs'}）`, '```', ...block.theirs.lines, '```', '');
	});
	return parts.join('\n');
}
