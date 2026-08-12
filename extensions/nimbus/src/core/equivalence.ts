/**
 * 移行前後の等価性確認（tasks.md T-179）。
 *
 * ライブラリの入れ替えや作り直しで一番怖いのは、**気づかないうちに振る舞いが変わる**こと。
 * 防ぐ道具は 1 つしかない — 移行の**前**に、いまの振る舞いをそのまま写したテストを書いておくこと。
 * 「仕様として正しいか」は問わない。正しくないところも含めて、いまのとおりに写す
 * （characterization test）。移行後に同じテストが通れば、変わっていないと言える。
 *
 * VS Code に依存しない。頼み方だけを置く。
 */

export interface BehaviorTarget {
	/** 表示用の相対パス */
	file: string;
	/** 対象のシンボル名（分かるとき） */
	symbol?: string;
	/** 写す対象のソース */
	code: string;
	/** `HEAD` の内容を使ったか（作業ツリーが既に書き換わっているとき true） */
	fromHead: boolean;
}

/** 貼り付ける行数の上限。長すぎるものは範囲を絞って呼び直してもらう */
const MAX_CODE_LINES = 300;

function clip(code: string): { code: string; omitted: number } {
	const lines = code.split(/\r?\n/);
	if (lines.length <= MAX_CODE_LINES) {
		return { code, omitted: 0 };
	}
	return { code: lines.slice(0, MAX_CODE_LINES).join('\n'), omitted: lines.length - MAX_CODE_LINES };
}

/**
 * 移行**前**に頼む文。
 * 「正しい仕様を書いて」ではなく「**いまのとおりに写して**」と言うのが要点。
 */
export function buildCharacterizationPrompt(target: BehaviorTarget): string {
	const { code, omitted } = clip(target.code);
	const where = target.symbol ? `${target.file}（${target.symbol}）` : target.file;
	const parts = [
		'これから作り替える／入れ替える前に、**いまの振る舞いを固定するテスト**を書いてください。',
		'',
		`対象: ${where}${target.fromHead ? '（作業ツリーは既に変わっているため、HEAD の内容を渡しています）' : ''}`,
		'',
		'条件:',
		'- **仕様として正しいかは問いません。** 正しくない挙動も、いまのとおりに写してください',
		'- 入力と出力の組を挙げ、**境界と例外**（空・null・上限・エラー時）を落とさないでください',
		'- 実装の中身ではなく、**外から見た振る舞い**を書いてください（内部の呼び出し回数などは書かない）',
		'- 既存のテストの書き方に合わせてください',
		'',
		'````',
		code,
		'````'
	];
	if (omitted > 0) {
		parts.push('', `（長いので先頭 ${MAX_CODE_LINES} 行だけを貼りました。残り ${omitted} 行はファイルを読んでください）`);
	}
	parts.push('', 'このテストは移行後にそのまま走らせて、**振る舞いが変わっていないこと**の証拠にします。');
	return parts.join('\n');
}

/**
 * 移行**後**に頼む文。
 * 落ちたテストを「直すもの」ではなく「**変わった証拠**」として扱わせる。
 */
export function buildEquivalencePrompt(target: BehaviorTarget): string {
	const where = target.symbol ? `${target.file}（${target.symbol}）` : target.file;
	return [
		`移行の前に書いた「振る舞いを固定するテスト」を走らせて、${where} が変わっていないかを確かめてください。`,
		'',
		'落ちたテストは**振る舞いが変わった証拠**です。テストを直して通す前に、次の 2 つに分けてください:',
		'',
		'1. **意図した変更** — なぜ変えたのか、そう変えてよい根拠は何かを書く。そのうえでテストを更新する',
		'2. **意図していない変更** — 実装の方を直す',
		'',
		'どちらか分からないものは、分からないと書いてください。**通すためにテストを緩めないでください。**'
	].join('\n');
}
