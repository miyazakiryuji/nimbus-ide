/**
 * 応答の Markdown を、描く前に「塊」へ分ける（tasks.md T-271）。
 *
 * **Webview 側で解析しない。** 理由は 2 つ ── ここなら VS Code に依存せず単体で検証できること、
 * そして webview を「受け取った塊を DOM に写すだけ」の薄い層に保てること。
 * 文字列を組み立てて `innerHTML` に入れる作りにすると、応答やツール結果がそのまま
 * HTML として解釈される余地が残る。塊にして渡せば、その余地が最初から無い。
 *
 * 対応するのは**応答に実際に出てくるものだけ**。完全な Markdown 実装は目指さない。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 行の中の断片 */
export type Inline =
	| { kind: 'text'; text: string }
	| { kind: 'code'; text: string }
	| { kind: 'strong'; text: string }
	| { kind: 'em'; text: string }
	| { kind: 'link'; text: string; href: string };

/** 塊 */
export type Block =
	| { kind: 'paragraph'; spans: Inline[] }
	| { kind: 'heading'; level: number; spans: Inline[] }
	| { kind: 'code'; language: string; text: string }
	| { kind: 'list'; ordered: boolean; items: Inline[][] }
	| { kind: 'quote'; spans: Inline[] }
	/**
	 * 表（T-304）。Claude はよく表で答えるのに種類が無く、
	 * `| 項目 | 値 |` がそのまま段落として並んでいた。
	 */
	| { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
	| { kind: 'rule' };

/**
 * リンクとして通す枠組み。
 * `javascript:` などをそのまま `href` に置くと、押した瞬間に実行される余地が残る。
 * 通らなかったものは**ただの文字**として出す（消さない ── 消すと本文が変わってしまう）。
 */
const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

/**
 * 行の中の記法。
 *
 * `_強調_` は**採らない**。`snake_case` の識別子が応答に頻繁に出るので、
 * 拾うと本文の意味が変わる。`**` と `*` だけにしておくほうが事故が少ない。
 */
const INLINE = /(`+)([^`]*?)\1|\*\*([\s\S]+?)\*\*|\*([^*\n]+?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

/** 行の中を断片に分ける */
export function parseInline(text: string): Inline[] {
	const spans: Inline[] = [];
	const push = (span: Inline): void => {
		if (span.kind === 'text' && span.text.length === 0) {
			return;
		}
		spans.push(span);
	};

	let last = 0;
	INLINE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = INLINE.exec(text)) !== null) {
		push({ kind: 'text', text: text.slice(last, match.index) });
		if (match[2] !== undefined) {
			push({ kind: 'code', text: match[2] });
		} else if (match[3] !== undefined) {
			push({ kind: 'strong', text: match[3] });
		} else if (match[4] !== undefined) {
			push({ kind: 'em', text: match[4] });
		} else if (match[5] !== undefined && match[6] !== undefined) {
			// 通らない枠組みは、記法ごと文字として残す
			if (SAFE_LINK.test(match[6])) {
				push({ kind: 'link', text: match[5], href: match[6] });
			} else {
				push({ kind: 'text', text: match[0] });
			}
		}
		last = match.index + match[0].length;
	}
	push({ kind: 'text', text: text.slice(last) });
	return spans;
}

const FENCE = /^(```+|~~~+)\s*([\w+#-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE = /^>\s?(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;

/**
 * 本文を塊に分ける。
 *
 * コードブロックは**閉じていなくても塊として出す** ── 応答は流れてくる途中で
 * 描かれるので、閉じるまで出さないと「書いている最中が見えない」ことになる。
 */
/** 表の区切り行（`| --- | :---: |` など） */
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	const lines = text.split('\n');
	let index = 0;

	/** 続いている段落・引用を溜める */
	let buffer: string[] = [];
	let bufferKind: 'paragraph' | 'quote' | undefined;

	const flush = (): void => {
		if (buffer.length === 0 || !bufferKind) {
			buffer = [];
			bufferKind = undefined;
			return;
		}
		const joined = buffer.join('\n').trim();
		if (joined.length > 0) {
			blocks.push(
				bufferKind === 'quote'
					? { kind: 'quote', spans: parseInline(joined) }
					: { kind: 'paragraph', spans: parseInline(joined) }
			);
		}
		buffer = [];
		bufferKind = undefined;
	};

	const collect = (kind: 'paragraph' | 'quote', line: string): void => {
		if (bufferKind && bufferKind !== kind) {
			flush();
		}
		bufferKind = kind;
		buffer.push(line);
	};

	while (index < lines.length) {
		const line = lines[index];

		const fence = FENCE.exec(line);
		if (fence) {
			flush();
			const closing = fence[1][0];
			const body: string[] = [];
			index += 1;
			while (index < lines.length && !new RegExp(`^${closing}{3,}\\s*$`).test(lines[index])) {
				body.push(lines[index]);
				index += 1;
			}
			// 閉じていれば 1 行進める。閉じていなければ末尾まで読み切っている
			index += 1;
			blocks.push({ kind: 'code', language: fence[2], text: body.join('\n') });
			continue;
		}

		if (line.trim().length === 0) {
			flush();
			index += 1;
			continue;
		}

		if (RULE.test(line)) {
			flush();
			blocks.push({ kind: 'rule' });
			index += 1;
			continue;
		}

		// 表（T-304）。ヘッダ行の次が区切り行（|---|---|）なら表として読む。
		// 区切りが無いものは表ではないので、段落のまま流す
		if (line.includes('|') && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1])) {
			flush();
			const cells = (row: string): Inline[][] =>
				row
					.trim()
					.replace(/^\|/, '')
					.replace(/\|$/, '')
					.split('|')
					.map((cell) => parseInline(cell.trim()));
			const header = cells(line);
			index += 2;
			const rows: Inline[][][] = [];
			while (index < lines.length && lines[index].includes('|') && lines[index].trim().length > 0) {
				rows.push(cells(lines[index]));
				index += 1;
			}
			blocks.push({ kind: 'table', header, rows });
			continue;
		}

		const heading = HEADING.exec(line);
		if (heading) {
			flush();
			blocks.push({ kind: 'heading', level: heading[1].length, spans: parseInline(heading[2]) });
			index += 1;
			continue;
		}

		const quote = QUOTE.exec(line);
		if (quote) {
			collect('quote', quote[1]);
			index += 1;
			continue;
		}

		const bullet = BULLET.exec(line);
		const numbered = NUMBER.exec(line);
		if (bullet || numbered) {
			flush();
			const ordered = !bullet;
			const items: Inline[][] = [];
			while (index < lines.length) {
				const item = ordered ? NUMBER.exec(lines[index]) : BULLET.exec(lines[index]);
				if (!item) {
					break;
				}
				items.push(parseInline(item[1]));
				index += 1;
			}
			blocks.push({ kind: 'list', ordered, items });
			continue;
		}

		collect('paragraph', line);
		index += 1;
	}

	flush();
	return blocks;
}

/**
 * コードブロックだけを取り出す。
 * 「エディタへ挿入」「新規ファイル」「ターミナルで実行」を出す判断に使う。
 */
export function codeBlocksIn(blocks: readonly Block[]): { language: string; text: string }[] {
	return blocks.filter((block): block is Extract<Block, { kind: 'code' }> => block.kind === 'code');
}
