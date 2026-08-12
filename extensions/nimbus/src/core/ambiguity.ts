/**
 * 日本語プロンプトの補助（tasks.md T-090）。
 *
 * 日本語の指示は**主語と対象が落ちやすい**。「あれを直して」「いい感じにして」は、
 * 書いた側には自明でも、受け取る側には決められない。走り出してから食い違いに気づくと、
 * そのターンぶんの時間と枠が丸ごと無駄になる。
 *
 * **送る前に**「これって〇〇のこと？」と聞き返せるようにする。
 * ただし**止めない** — 曖昧なまま進めたいこともある。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Vagueness {
	/** 見つかった曖昧さの種類 */
	kind: 'demonstrative' | 'vague-quality' | 'no-target' | 'ambiguous-scope';
	/** 引っかかった語 */
	matched: string;
	/** 何を聞き返せばいいか */
	question: string;
}

interface Rule {
	kind: Vagueness['kind'];
	re: RegExp;
	question: string;
}

/**
 * 判定の規則。
 *
 * **狭く取る。** 「これ」「それ」は日本語では普通に出てくるので、
 * **文の中で対象が他に示されていない**ときだけ拾う（呼び出し側で判定）。
 * 誤検知が多いと、確認そのものが読み飛ばされる。
 */
const RULES: Rule[] = [
	{
		kind: 'demonstrative',
		// 指示語だけで対象を指している（直後に名詞が続かない形）
		re: /(?:^|[\s、。])(あれ|それ|これ|さっきの|例の)(?=[\sをにはがも、。]|$)/,
		question: 'どのファイル・どの箇所のことですか'
	},
	{
		kind: 'vague-quality',
		// 後続を縛らない。「きれいにして」の「して」まで見ると当たらなくなる（実測）
		re: /(いい感じ|いいかんじ|よしなに|適当に|うまく|ちゃんと|きれいに)/,
		question: '何をもって良しとしますか（満たすべき条件）'
	},
	{
		kind: 'no-target',
		re: /^(?:直して|なおして|修正して|やって|お願い|対応して)[。!！]?$/,
		question: '何をどう直しますか'
	},
	{
		kind: 'ambiguous-scope',
		// 同上。「全部きれいに」のように動詞が続く形が普通
		re: /(全部|ぜんぶ|すべて|一括で|まとめて)/,
		question: 'どこまでが対象ですか（範囲を区切ってください）'
	}
];

/** 対象が示されているか。パス・拡張子・鉤括弧・コードスパンがあれば示されているとみなす */
function hasConcreteTarget(text: string): boolean {
	return /[./][\w-]+\.\w+|`[^`]+`|「[^」]+」|[A-Za-z_][\w]*\(\)/.test(text);
}

/**
 * 短すぎるものは判定しない。
 * ただし **2 文字まで下げる** — 「直して」だけの一言こそ拾いたいので、
 * 長さで切ると `no-target` の規則が一度も効かない（実測）。
 * 「はい」「ありがとう」はどの規則にも当たらないので、これで通る。
 */
const MIN_LENGTH = 2;

/**
 * 曖昧さを探す。
 * 対象がはっきり書かれていれば、指示語があっても拾わない
 * （「`a.ts` のこれを直して」は曖昧ではない）。
 */
export function findVagueness(text: string): Vagueness[] {
	const trimmed = text.trim();
	if (trimmed.length < MIN_LENGTH) {
		return [];
	}
	const concrete = hasConcreteTarget(trimmed);
	const found: Vagueness[] = [];
	for (const rule of RULES) {
		if (concrete && (rule.kind === 'demonstrative' || rule.kind === 'no-target')) {
			// 対象が書いてあるなら、指示語は問題にならない
			continue;
		}
		const match = rule.re.exec(trimmed);
		if (match) {
			found.push({ kind: rule.kind, matched: (match[1] ?? match[0]).trim(), question: rule.question });
		}
	}
	return found;
}

/**
 * 聞き返す文を作る。
 * **決めつけない。** 「〇〇のことですか」と候補を出すのではなく、
 * 何が決まっていないかを言って、利用者に埋めてもらう。
 */
export function clarificationMessage(found: readonly Vagueness[]): string {
	return found.map((item) => `「${item.matched}」— ${item.question}`).join('\n');
}
