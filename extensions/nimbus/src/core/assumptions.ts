/**
 * 前提・仮定の抽出（T-186）。
 *
 * エージェントは、足りない情報を**自分で埋めて**進む。埋めたこと自体は悪くないが、
 * それが本文の中に紛れると読み飛ばされ、違っていたことに気づくのは成果物を見たあとになる。
 * だから「置いた仮定」だけを抜き出して、目立つ場所に並べる。
 *
 * 抽出は本文の言い回しから行う。モデルに追加で問い合わせない（費用と待ち時間が増えるうえ、
 * 「仮定を述べよ」と指示すると、本来なら聞き返すべき場面でも仮定して進むようになる）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** 仮定を表す言い回し。日本語・英語の両方を拾う */
const ASSUMPTION_PATTERNS: RegExp[] = [
	/(?:と|を)(?:仮定|想定)(?:して|し、|します|しました|する)/,
	/前提(?:として|で|に)/,
	/(?:とりあえず|ひとまず|一旦)[^。]*(?:進め|しておき|してお|扱い)/,
	/(?:と|に)(?:みなし|見なし)(?:て|ます|ました)/,
	/\bassum(?:e|ing|ed)\b/i,
	/\bI'll assume\b/i,
	/\bfor now\b.*\b(?:use|treat|assume)\b/i
];

/** 明らかに仮定ではないもの（否定形・疑問形）は拾わない */
const NOT_ASSUMPTION: RegExp[] = [
	/仮定(?:せず|しないで|しません)/,
	/(?:ますか|ですか|でしょうか)[?？]?$/
];

const MAX_LENGTH = 160;

/** 本文を、句点・改行・箇条書きの区切りで文に割る */
function splitSentences(text: string): string[] {
	return text
		.split(/\n+|(?<=。)|(?<=\. )/)
		.map((line) => line.replace(/^\s*[-*・]\s*/, '').trim())
		.filter((line) => line.length > 0);
}

/**
 * 本文から「置かれた仮定」を抜き出す。
 * 見つからなければ空配列（無理に何かを返さない）。
 */
export function extractAssumptions(text: string): string[] {
	const found: string[] = [];
	for (const sentence of splitSentences(text)) {
		if (NOT_ASSUMPTION.some((re) => re.test(sentence))) {
			continue;
		}
		if (!ASSUMPTION_PATTERNS.some((re) => re.test(sentence))) {
			continue;
		}
		const trimmed = sentence.length > MAX_LENGTH ? `${sentence.slice(0, MAX_LENGTH)}…` : sentence;
		if (!found.includes(trimmed)) {
			found.push(trimmed);
		}
	}
	return found;
}
