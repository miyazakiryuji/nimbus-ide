/**
 * 承認ルールを画面から扱うための言い換えと点検（tasks.md T-028）。
 *
 * ルールは `nimbus.permissions.alwaysAllow` に `Bash(npm test)` の形で並ぶ（T-038）。
 * 書式としては読めるが、**それが何を許すのか**は書式からは伝わらない。
 * 一覧に出すときは「何を許しているか」を日本語で添える — 許可の範囲を読み違えたまま
 * 溜めていくのが、この手の設定でいちばん危ない。
 *
 * あわせて、**広いルールに飲み込まれている狭いルール**を見つける。
 * `Read` があるのに `Read(*.md)` が残っていると、消したつもりの範囲が消えていない。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import { formatRule, parseRule, type ApprovalRule } from './approvalRules';

/** そのルールが何を許すのかを日本語で言う */
export function explainRule(rule: ApprovalRule): string {
	if (!rule.arg) {
		return `${rule.tool} を、内容にかかわらず確認せず許可`;
	}
	if (rule.arg.startsWith('*.')) {
		return `拡張子が .${rule.arg.slice(2)} のファイルへの ${rule.tool} を確認せず許可`;
	}
	return `${rule.tool} のうち「${rule.arg}」で始まるものを確認せず許可`;
}

export interface RuleView {
	/** 保存されている文字列そのもの */
	text: string;
	rule?: ApprovalRule;
	/** 何を許すのか。読めないルールでは undefined */
	explanation?: string;
	/** 書式として読めるか */
	valid: boolean;
	/** より広いルールに飲み込まれているか。飲み込んでいる側の文字列 */
	coveredBy?: string;
}

/**
 * 一方が他方を完全に含むか（`broad` があれば `narrow` は要らないか）。
 *
 * 同じツールで、広いほうに絞り込みが無ければ含む。
 * コマンドの前方一致どうしなら、短いほうが長いほうを含む（語の切れ目で見る）。
 */
function covers(broad: ApprovalRule, narrow: ApprovalRule): boolean {
	if (broad.tool !== narrow.tool) {
		return false;
	}
	if (!broad.arg) {
		// 絞り込みの無いほうは、同じツールのすべてを含む
		return Boolean(narrow.arg);
	}
	if (!narrow.arg) {
		return false;
	}
	// 拡張子どうし・前方一致どうしでしか比べない（種類が違えば包含関係は言えない）
	const broadIsExt = broad.arg.startsWith('*.');
	const narrowIsExt = narrow.arg.startsWith('*.');
	if (broadIsExt !== narrowIsExt) {
		return false;
	}
	if (broadIsExt) {
		return false; // `*.md` と `*.ts` に包含関係は無い
	}
	return narrow.arg === `${broad.arg} ` || narrow.arg.startsWith(`${broad.arg} `);
}

/** 保存されている一覧を、画面に出せる形に開く */
export function viewRules(texts: readonly string[]): RuleView[] {
	const parsed = texts.map((text) => ({ text, rule: parseRule(text) }));
	return parsed.map(({ text, rule }) => {
		if (!rule) {
			return { text, valid: false };
		}
		const broader = parsed.find(
			(other) => other.rule && other.text !== text && covers(other.rule, rule)
		);
		return {
			text,
			rule,
			explanation: explainRule(rule),
			valid: true,
			coveredBy: broader?.text
		};
	});
}

/**
 * 足そうとしているルールを点検する。
 * 追加そのものは止めない — 判断は人のものなので、**言うだけ言って通す**。
 */
export interface RuleCheck {
	/** 書式として読めるか。読めなければ足せない */
	valid: boolean;
	explanation?: string;
	/** 足す前に伝えるべきこと */
	warnings: string[];
}

export function checkNewRule(text: string, existing: readonly string[]): RuleCheck {
	const rule = parseRule(text);
	if (!rule) {
		return {
			valid: false,
			warnings: ['書式が読めません。`Read` / `Write(*.md)` / `Bash(npm test)` のように書きます。']
		};
	}
	const warnings: string[] = [];
	const normalized = formatRule(rule);
	if (existing.some((other) => parseRule(other) && formatRule(parseRule(other)!) === normalized)) {
		warnings.push('同じルールが既にあります。');
	}
	if (!rule.arg) {
		warnings.push(`${rule.tool} を**内容にかかわらず**許可します。範囲が広いので、意図したものか確かめてください。`);
	}
	const covered = existing.filter((other) => {
		const parsedOther = parseRule(other);
		return parsedOther && covers(parsedOther, rule);
	});
	if (covered.length > 0) {
		warnings.push(`より広い \`${covered[0]}\` が既にあるので、このルールは効果がありません。`);
	}
	// 取り返しがつかない操作はルールに関わらず毎回聞く（T-038 の約束）ので、それを伝える
	warnings.push('取り返しがつかない操作（`rm -rf` など）は、ルールがあっても毎回確認します。');
	return { valid: true, explanation: explainRule(rule), warnings };
}

/** 読めないルールと、飲み込まれているルールを取り除いた一覧 */
export function tidyRules(texts: readonly string[]): string[] {
	return viewRules(texts)
		.filter((view) => view.valid && !view.coveredBy)
		.map((view) => view.text);
}
