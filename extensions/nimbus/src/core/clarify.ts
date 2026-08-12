/**
 * 着手前の確認（T-185）。
 *
 * 曖昧な指示をそのまま走らせると、エージェントは**自分で前提を埋めて**動き出す。
 * 埋めた前提が違っていたと分かるのは、たいてい何十ファイルも書き換えたあと。
 * だから「走らせる前」に、足りていないものを名指しで聞く。
 *
 * 判定は保守的にする。少しでも具体性があれば黙って通す。
 * **毎回聞かれる仕組みは、3 回目で無視されるようになる**（そうなったら意味が無い）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type ClarityLevel = 'ok' | 'vague';

export interface ClarityIssue {
	/** なぜ引っかかったか（利用者に見せる） */
	reason: string;
	/** 代わりに何を書けばよいか */
	question: string;
}

export interface ClarityAssessment {
	level: ClarityLevel;
	issues: ClarityIssue[];
}

/** 具体性の手がかり。1 つでもあれば「対象がある」とみなす */
const CONCRETE_HINTS: RegExp[] = [
	/[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|scss|html|yml|yaml|sh|py|dart|go|rs|java|kt|swift|sql)\b/i, // ファイル名
	/`[^`]+`/, // コード引用
	/\b[A-Za-z_][A-Za-z0-9_]*\(\)/, // 関数呼び出し
	/#\d+\b/, // issue 番号
	/\bT-\d{3}\b/, // タスク ID
	/https?:\/\//, // URL
	/[/\\][\w.-]+[/\\]/ // パスらしきもの
];

/**
 * これ自体が曖昧さの合図になる言い回し。
 *
 * `solvedByTarget` は「対象がはっきりしていれば、もう聞かなくてよい」もの。
 * 対象さえ分かれば実務上は困らない指摘で毎回止めると、確認そのものが無視される。
 * バグ報告だけは別で、**対象が分かっても再現手順が無ければ動きようがない**。
 */
const VAGUE_PHRASES: { pattern: RegExp; reason: string; question: string; solvedByTarget: boolean }[] = [
	{
		pattern: /(いい感じ|よしなに|適当に|うまいこと|お任せ|なんとか)/,
		reason: '「どうなっていれば良いか」が書かれていません',
		question: '完成したと判断できる条件を 1 つ書いてください（例: このテストが通る）',
		solvedByTarget: true
	},
	{
		pattern: /(全部|すべて|一括|まとめて)(直|修正|変更|置換|消|削除|リファクタ)/,
		reason: '範囲が「全部」になっています',
		question: '対象をファイルまたはディレクトリで区切ってください',
		solvedByTarget: true
	},
	{
		pattern: /(バグ|不具合|エラー|おかしい|動かない)/,
		reason: '現象は書かれていますが、再現手順や実際の出力がありません',
		question: '再現手順と、実際に出たメッセージを貼ってください',
		solvedByTarget: false
	},
	{
		pattern: /(きれいに|整理|リファクタ)/,
		reason: '「整理」の意味は人によって違います',
		question: '何が困っているのかを書いてください（重複・命名・依存の向き など）',
		solvedByTarget: true
	}
];

/** 対象が見当たらないときに聞くこと */
const NO_TARGET: ClarityIssue = {
	reason: 'どのファイル・どの場所の話かが書かれていません',
	question: '対象のファイル名か、探す手がかり（関数名・エラーメッセージ）を書いてください'
};

/** 短すぎるときに聞くこと */
const TOO_SHORT: ClarityIssue = {
	reason: '指示が短く、判断の材料が足りません',
	question: '何を・どこで・どうなれば完了か、を書き足してください'
};

/** 質問・相談は「実行させる指示」ではないので確認しない */
const QUESTION_LIKE = /(です?か[?？]?$|ますか[?？]?$|[?？]\s*$|どう(思う|かな)|教えて)/;

/** 会話の継続（前のやり取りに文脈がある）は確認しない */
const CONTINUATION = /^(はい|うん|それで|続け|お願い|ありがとう|ok|yes|no)/i;

const MIN_LENGTH = 12;

/**
 * 指示の具体性を見る。
 *
 * @param text 送ろうとしている指示
 * @param hasHistory 既に会話が続いているか（続きなら文脈があるので確認しない）
 */
export function assessClarity(text: string, hasHistory = false): ClarityAssessment {
	const trimmed = text.trim();
	const ok: ClarityAssessment = { level: 'ok', issues: [] };

	if (trimmed.length === 0 || hasHistory) {
		return ok;
	}
	if (QUESTION_LIKE.test(trimmed) || CONTINUATION.test(trimmed)) {
		return ok;
	}

	const issues: ClarityIssue[] = [];
	const hasConcreteTarget = CONCRETE_HINTS.some((re) => re.test(trimmed));

	if (trimmed.length < MIN_LENGTH && !hasConcreteTarget) {
		issues.push(TOO_SHORT);
	}
	for (const { pattern, reason, question, solvedByTarget } of VAGUE_PHRASES) {
		if (!pattern.test(trimmed)) {
			continue;
		}
		if (solvedByTarget && hasConcreteTarget) {
			continue; // 対象が分かっているなら、これ以上は聞かない
		}
		issues.push({ reason, question });
	}
	if (!hasConcreteTarget && issues.length > 0) {
		issues.push(NO_TARGET);
	}

	return issues.length > 0 ? { level: 'vague', issues } : ok;
}

/** 確認ダイアログに出す本文 */
export function formatClarification(assessment: ClarityAssessment): string {
	return assessment.issues
		.map((issue, index) => `${index + 1}. ${issue.reason}\n   → ${issue.question}`)
		.join('\n');
}
