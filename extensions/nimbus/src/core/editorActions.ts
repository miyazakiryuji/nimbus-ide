/**
 * エディタから直接 Claude に頼む（tasks.md T-171 / T-172）。
 *
 * 「この関数をリファクタして」と頼むのに、ファイル名と行番号を打ち直す必要は無い。
 * 選択範囲やカーソル位置のシンボルは IDE がすでに知っている。
 * **知っていることを人に入力させない**のが、エディタの上に乗る価値の一つ。
 *
 * VS Code に依存しない。頼みごとの文面だけを置く。
 */

/** 依頼の種類。実務でよく使う 4 つだけを前に出す */
export type EditorIntent = 'explain' | 'refactor' | 'test' | 'ask';

interface IntentSpec {
	label: string;
	detail: string;
	instruction: string;
}

const INTENTS: Record<EditorIntent, IntentSpec> = {
	explain: {
		label: '説明して',
		detail: '何をしているコードなのか、なぜこう書かれているのかを読み解く',
		instruction: 'このコードが何をしているのか、なぜこう書かれているのかを説明してください。'
	},
	refactor: {
		label: 'リファクタして',
		detail: '振る舞いを変えずに整理する',
		instruction:
			'このコードを、**振る舞いを変えずに**整理してください。何をどう変えるかを先に説明してから、直してください。'
	},
	test: {
		label: 'テストを書いて',
		detail: 'このコードに対するテストを足す',
		instruction:
			'このコードに対するテストを書いてください。既存のテストの書き方に合わせ、何を確かめるべきかを先に挙げてから書いてください。'
	},
	ask: {
		label: '自由に指示する',
		detail: 'この場所を指したまま、自分で書く',
		instruction: ''
	}
};

export function intentChoices(): { intent: EditorIntent; label: string; detail: string }[] {
	return (Object.keys(INTENTS) as EditorIntent[]).map((intent) => ({
		intent,
		label: INTENTS[intent].label,
		detail: INTENTS[intent].detail
	}));
}

export interface SelectionContext {
	/** 表示用の相対パス */
	file: string;
	/** 1 起点 */
	startLine: number;
	/** 1 起点 */
	endLine: number;
	code: string;
	/** シンボル名（コードレンズから来たとき） */
	symbol?: string;
}

/** 貼り付ける行数の上限。ファイル丸ごとを選ばれても文脈を溶かさない */
const MAX_CODE_LINES = 200;

export function truncateCode(code: string, maxLines: number = MAX_CODE_LINES): { code: string; omitted: number } {
	const lines = code.split(/\r?\n/);
	if (lines.length <= maxLines) {
		return { code, omitted: 0 };
	}
	return { code: lines.slice(0, maxLines).join('\n'), omitted: lines.length - maxLines };
}

/**
 * 送る文。**場所を先に、コードを後に**置く。
 * 場所が分かれば、Claude は必要に応じて自分で周辺を読みに行ける。
 */
export function buildSelectionPrompt(
	context: SelectionContext,
	intent: EditorIntent,
	freeText?: string
): string {
	const instruction = intent === 'ask' ? (freeText ?? '').trim() : INTENTS[intent].instruction;
	const where = context.symbol
		? `${context.file}:${context.startLine}–${context.endLine}（${context.symbol}）`
		: `${context.file}:${context.startLine}–${context.endLine}`;
	const { code, omitted } = truncateCode(context.code);
	const parts = [instruction, '', `対象: ${where}`, ''];
	parts.push('````', code, '````');
	if (omitted > 0) {
		parts.push('', `（長いので先頭 ${MAX_CODE_LINES} 行だけを貼りました。残り ${omitted} 行はファイルを読んでください）`);
	}
	return parts.join('\n').replace(/^\n+/, '');
}

/** コードレンズを出すシンボルの種類（SymbolKind の数値）— 関数・メソッド・クラス・コンストラクタ */
const LENS_KINDS = new Set([4, 5, 8, 11]);

export function shouldShowLens(kind: number): boolean {
	return LENS_KINDS.has(kind);
}
