/**
 * 何度も言っている指示を見つける（tasks.md T-041 の残り）。
 *
 * 毎回同じことを頼んでいるなら、それは CLAUDE.md に書けば済む話。
 * 気づけないまま毎ターン同じ前置きを打ち続けるのが、いちばん静かな無駄になる。
 *
 * 判定は保守的にする。**言い回しが違うだけの同じ指示**を拾いたいが、
 * 「やって」「OK」のような短い相槌まで拾うと、提案が雑音になって読まれなくなる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface RepeatedInstruction {
	/** 代表となる文（最初に出てきた言い回し） */
	text: string;
	/** 何回言ったか */
	count: number;
}

/** これより短い指示は見ない（相槌・一言の返事を拾わないため） */
const MIN_LENGTH = 8;

/** これ以上言っていたら「毎回言っている」と見なす */
const REPEAT_THRESHOLD = 3;

/**
 * 比べるための正規化。
 *
 * 表記ゆれ（空白・記号・敬体の末尾）を落とす。**意味は変えない**（訳したり要約したりしない）。
 * ここで頑張りすぎると別の指示が同じものに見えるので、削るのは記号と装飾だけにする。
 */
export function normalizeInstruction(text: string): string {
	return text
		.toLowerCase()
		.replace(/[`"'*_#>|]/g, '')
		.replace(/[。、．，!！?？~〜\-—…]/g, '')
		// 依頼の語尾を落とす。「書いてください」「書いてほしい」「書いて」を同じものとして扱うため、
		// 丁寧形を外したあとに残る「て」も落とす（ここまでで止める。意味に踏み込むと別の指示が混ざる）
		.replace(/(てください|て下さい|でください|で下さい|てほしい|てね|てくれ|お願いします|お願い)$/u, '')
		.replace(/て$/u, '')
		.replace(/\s+/g, '')
		.trim();
}

/**
 * 指示を 1 行ずつに割る。
 *
 * 1 通のメッセージに複数の指示が入ることが多い（「A して。あと B も」）ので、
 * メッセージ単位ではなく**文単位**で数える。箇条書きの記号は落とす。
 */
export function splitInstructions(message: string): string[] {
	return message
		.split(/\n+|(?<=[。！？])/u)
		.map((line) => line.replace(/^\s*[-*+]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim())
		.filter((line) => line.length >= MIN_LENGTH && !isHarnessMarkup(line));
}

/**
 * 人が書いた指示ではない行を落とす。
 *
 * 記録には、スラッシュコマンドの展開（`<command-name>/effort</command-name>` など）や
 * 実行結果の差し込みがそのまま混ざる。**実データで確認したところ、除外しないと
 * 提案の上位がこれで埋まる**（人は同じコマンドを何度も打つため）。
 */
export function isHarnessMarkup(line: string): boolean {
	return /^<[a-z-]+>/i.test(line) || /<\/[a-z-]+>/i.test(line) || line.startsWith('[Request interrupted');
}

/**
 * 繰り返している指示を、多い順に返す。
 *
 * 同じメッセージの中で 2 回言っても 1 回と数える（コピペした長文で数が跳ねるのを防ぐ）。
 */
export function findRepeatedInstructions(
	messages: readonly string[],
	threshold: number = REPEAT_THRESHOLD
): RepeatedInstruction[] {
	const counts = new Map<string, { text: string; count: number }>();
	for (const message of messages) {
		const seenHere = new Set<string>();
		for (const line of splitInstructions(message)) {
			const key = normalizeInstruction(line);
			if (key.length < MIN_LENGTH || seenHere.has(key)) {
				continue;
			}
			seenHere.add(key);
			const entry = counts.get(key);
			if (entry) {
				entry.count++;
			} else {
				counts.set(key, { text: line, count: 1 });
			}
		}
	}
	return [...counts.values()]
		.filter((entry) => entry.count >= threshold)
		.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}
