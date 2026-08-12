/**
 * 複数ステップのワークフロー定義（tasks.md T-149）と、解説モード（T-045）。
 *
 * 「調査 → 実装 → テスト → レビュー」は毎回同じ流れなのに、毎回手で 4 回頼んでいる。
 * 途中で 1 つ飛ばしても気づかない。**流れとして定義**して、順に進める。
 *
 * 解説モード（T-045）は流れとは別の話に見えるが、どちらも
 * 「**何をしているかを言わせる**」ことで成り立つので、同じところに置く。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface WorkflowStep {
	name: string;
	/** この段でやってほしいこと */
	prompt: string;
	/** 次へ進む前に人が確認するか */
	confirm: boolean;
}

export interface Workflow {
	name: string;
	description: string;
	steps: WorkflowStep[];
}

/**
 * 出荷時の流れ。
 * **各段の最後に「次へ進んでよいか」を言わせる**のが肝 — 言わせないと、
 * 調査のつもりで実装まで進んでしまう。
 */
export const BUILTIN_WORKFLOWS: readonly Workflow[] = [
	{
		name: '調査 → 実装 → テスト → レビュー',
		description: 'ふだんの開発。段ごとに止まって確認する',
		steps: [
			{
				name: '調査',
				prompt:
					'{{やること}}\n\nまず**調べるだけ**にしてください。関係する場所と、直しかたの見当を報告してください。'
					+ '\nこの段ではコードを変更しないでください。最後に「実装に進んでよいか」を一言で述べてください。',
				confirm: true
			},
			{
				name: '実装',
				prompt:
					'さきほどの見当どおりに実装してください。'
					+ '\n途中で見当が違うと分かったら、**直さずに止めて**報告してください。',
				confirm: true
			},
			{
				name: 'テスト',
				prompt:
					'いまの変更を確かめるテストを足し、実行してください。'
					+ '\n**通ったログを示してください。** 通っていないなら、通っていないと言ってください。',
				confirm: true
			},
			{
				name: 'レビュー',
				prompt:
					'いまの変更を自分でレビューしてください。'
					+ '\n見落としがちな点（エラー処理・境界値・既存の振る舞いを壊していないか）を挙げ、'
					+ '根拠となる行を添えてください。直すかどうかは私が決めます。',
				confirm: false
			}
		]
	},
	{
		name: '不具合を直す',
		description: '再現 → 原因 → 修正 → 回帰',
		steps: [
			{
				name: '再現',
				prompt: '{{症状}}\n\nまず**落ちるテスト**を書いて、症状を再現してください。直すのはその後です。',
				confirm: true
			},
			{ name: '原因', prompt: 'なぜそうなるのかを、根拠となる行を示して説明してください。', confirm: true },
			{ name: '修正', prompt: 'さきほどのテストが通るように直してください。', confirm: true },
			{
				name: '回帰',
				prompt: 'テスト全体を走らせ、他が壊れていないことを確かめてください。結果をそのまま示してください。',
				confirm: false
			}
		]
	}
];

/** `{{やること}}` のような変数を入力で埋める（`core/promptLibrary.ts` と同じ書式） */
export function fillStep(step: WorkflowStep, input: string): string {
	return step.prompt.includes('{{')
		? step.prompt.replace(/\{\{[^}]*\}\}/g, input)
		: step.prompt;
}

export interface WorkflowState {
	workflowName: string;
	/** 0 始まり。全部終わったら steps.length になる */
	stepIndex: number;
	input: string;
}

/** 次の段。終わっていれば undefined */
export function nextStep(workflow: Workflow, state: WorkflowState): WorkflowStep | undefined {
	return workflow.steps[state.stepIndex];
}

export function advance(state: WorkflowState): WorkflowState {
	return { ...state, stepIndex: state.stepIndex + 1 };
}

export function isFinished(workflow: Workflow, state: WorkflowState): boolean {
	return state.stepIndex >= workflow.steps.length;
}

/** いまどこにいるかを 1 行で。**流れの中の位置が見えないと、飛ばしても気づかない** */
export function describeProgress(workflow: Workflow, state: WorkflowState): string {
	if (isFinished(workflow, state)) {
		return `${workflow.name} — 全 ${workflow.steps.length} 段が終わりました`;
	}
	const step = workflow.steps[state.stepIndex];
	return `${workflow.name} — ${state.stepIndex + 1}/${workflow.steps.length} ${step.name}`;
}

/**
 * 解説モード（tasks.md T-045）。
 * **判断の理由を横に出させる。** 画面共有すればそのまま教材になる、という狙いなので、
 * 「何をしたか」ではなく「**なぜそうしたか**」を求める。
 */
export const EXPLAIN_MODE_PROMPT = [
	'これ以降、作業しながら**判断の理由**を短く添えてください。',
	'',
	'- ファイルを読む前に、**なぜそれを読むのか**を 1 行',
	'- 設計を選ぶときは、**選ばなかった案と、選ばなかった理由**を 1 行',
	'- 詰まったときは、**何が分からないのか**を先に言う',
	'',
	'解説は 1 行ずつで十分です。長い説明は要りません。',
	'作業そのものは、いつもどおり進めてください。'
].join('\n');
