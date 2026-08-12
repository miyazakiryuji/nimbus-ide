/**
 * ペルソナ・状態の色・進めかたのモード（tasks.md T-063 / T-064 / T-190 / T-191）。
 *
 * どれも「**エージェントとの距離感**」を決めるもの。
 * 口調（T-063）、いま何をしているかの色（T-064）、どちらが書く番か（T-190 / T-191）。
 * 別々の機能に見えるが、利用者にとっては「どう付き合うか」の一つの設定なので同じところに置く。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Persona {
	name: string;
	description: string;
	/** システムプロンプトへ足す指示。空なら既定のまま */
	instruction: string;
}

/**
 * 出荷時のペルソナ。
 * **既定は「そのまま」**（何も足さない）。口調を勝手に変えられるのは好みが分かれる。
 * ヘルプの「ゆあ」は F6 で入っているので、ここでは**コックピット側**の選択肢として持つ。
 */
export const BUILTIN_PERSONAS: readonly Persona[] = [
	{ name: 'そのまま', description: '既定。口調を変えない', instruction: '' },
	{
		name: '簡潔',
		description: '前置きと相づちを省く',
		instruction:
			'返事は簡潔にしてください。前置き・相づち・要約の繰り返しをしないでください。'
			+ '結論から書き、根拠は必要なぶんだけ添えてください。'
	},
	{
		name: 'ていねいに説明',
		description: '判断の理由を添える（教材向け）',
		instruction:
			'作業しながら、判断の理由を 1 行ずつ添えてください。'
			+ 'なぜそのファイルを読むのか、なぜその設計を選んだのかが分かるようにしてください。'
	},
	{
		name: 'ゆあ',
		description: '後輩プログラマの口調（ヘルプと同じ）',
		instruction:
			'あなたは「ゆあ」という名前の、利用者を慕う後輩プログラマとして振る舞ってください。'
			+ '日本語で、やわらかい口調で話してください。ただし**技術的な正確さは崩さないでください**。'
			+ '分からないことを分かったふりで埋めないでください。'
	}
];

export function findPersona(name: string | undefined): Persona {
	return BUILTIN_PERSONAS.find((persona) => persona.name === name) ?? BUILTIN_PERSONAS[0];
}

/** セッションの状態。色の出し分けに使う（T-064） */
export type AgentState = 'idle' | 'thinking' | 'waiting-approval' | 'error';

/**
 * 状態に対応する VS Code のテーマ色。
 *
 * **新しい配色は足さない**（`tasks.md` の IntelliJ 節と同じ方針）。
 * VS Code の既存トークンを使うので、Nimbus Dark / Light のどちらでも馴染む。
 * 「思考中は青、待機は緑」は色そのものを指定するのではなく、
 * **既にその意味を持っているトークン**へ寄せる。
 */
export function stateColor(state: AgentState): string | undefined {
	switch (state) {
		case 'waiting-approval':
			// 人の判断を待っている＝止まっている。警告の背景で目に入るようにする
			return 'statusBarItem.warningBackground';
		case 'error':
			return 'statusBarItem.errorBackground';
		case 'thinking':
			// 動いているだけで異常ではないので、目立たせない
			return undefined;
		default:
			return undefined;
	}
}

/** 状態を 1 語で。ステータスバーの tooltip に出す */
export function stateLabel(state: AgentState): string {
	switch (state) {
		case 'thinking':
			return '作業中';
		case 'waiting-approval':
			return '承認待ち';
		case 'error':
			return 'エラー';
		default:
			return '待機中';
	}
}

/**
 * 進めかたのモード（T-190 交代 / T-191 肩越し）。
 *
 * どちらも「**書く主体を明示的に決める**」もの。曖昧なまま進むと、
 * 直してほしくないところまで直される。
 */
export type TurnMode = 'agent' | 'human' | 'shoulder';

export const TURN_MODE_LABEL: Record<TurnMode, string> = {
	agent: 'エージェントが書く',
	human: '私が書く（見ているだけ）',
	shoulder: '肩越し（聞かれたときだけ）'
};

export function turnModeInstruction(mode: TurnMode): string {
	switch (mode) {
		case 'human':
			return [
				'これから**私が書きます**。',
				'',
				'- ファイルを変更しないでください',
				'- 聞かれるまで提案もしないでください',
				'- 私が「見て」と言ったときだけ、気づいたことを述べてください'
			].join('\n');
		case 'shoulder':
			return [
				'**肩越しモード**にします。私が書くので、横で見ていてください。',
				'',
				'- ふだんは黙っていてください。ファイルも変更しないでください',
				'- ただし**これは明らかに壊れる**と分かったときだけ、短く指摘してください',
				'- 好みの問題（命名・書き方の流儀）では口を出さないでください'
			].join('\n');
		default:
			return 'ここからは、いつもどおりあなたが書いてください。';
	}
}
