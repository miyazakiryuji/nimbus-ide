/**
 * 使い始めの「準備」（tasks.md T-285）。
 *
 * 実際に利用者が **Claude Code の繋ぎかたで迷った**。原因は導線で、
 * 案内が出るのは*送信を試みたあと*、しかも中身は「設定 `nimbus.claudeCodeExecutable` に
 * パスを指定してください」── **設定名を告げるだけで、その場では直せない**。
 *
 * ここは「何が足りないか」と「押せば直る手段」を組にして返す。
 * 直す場所を、詰まった場所（コックピット）に置けるようにするための材料
 * （人間工学 E2「結果は原因の近くに出す」／ E4「場所で引ける経路を作る」）。
 *
 * **推測で直さない。** 足りないものを挙げて、押すかどうかは利用者が決める。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** その項目が使い始めを止めているか */
export type ReadyState =
	/** 満たしている */
	| 'ok'
	/** これが無いと動かない */
	| 'blocked'
	/** まだ確かめられない（動かしてみないと分からない） */
	| 'unknown';

/** 押せる手段。**押したら直る**ところまでを 1 つにする（T-244） */
export interface ReadyAction {
	label: string;
	/** 走らせるコマンド ID。`ALLOWED_ACTIONS` に載っているものだけ */
	command: string;
}

export interface ReadyCheck {
	id: 'executable' | 'folder' | 'trust' | 'auth';
	title: string;
	state: ReadyState;
	/** いまどうなっているか。事実だけ書く */
	detail: string;
	actions: ReadyAction[];
}

export interface ReadinessInput {
	/** 見つかった Claude Code の場所。見つからなければ undefined */
	executable?: string;
	/** 繋いだ先の呼び名（リモートのときだけ）。手元なら undefined */
	remoteLabel?: string;
	/** フォルダを開いているか */
	hasFolder: boolean;
	/** そのフォルダを信頼しているか */
	trusted: boolean;
	/** 一度でもセッションが起動して分かった課金モード。未確認なら undefined */
	apiKeySource?: string;
	/**
	 * 認証で落ちたときのメッセージ。
	 * 「入っているのに動かない」は**見つからない**のと同じくらい迷う（T-285）。
	 */
	authError?: string;
}

/**
 * そのエラーが「ログインしていない」に見えるか。
 *
 * Claude Code 側の文言はこちらで決められないので、**言い切らない** ──
 * 当たっていれば近道になり、外していても普通のエラーとして読めるようにしておく。
 */
export function looksLikeAuthProblem(message: string): boolean {
	const text = message.toLowerCase();
	return [
		'not logged in',
		'login',
		'unauthorized',
		'authentication',
		'authenticate',
		'invalid api key',
		'api key',
		'401',
		'credit balance'
	].some((needle) => text.includes(needle));
}

/**
 * webview から走らせてよいコマンド。
 *
 * 画面のボタンが**任意のコマンドを呼べる**状態にはしない。
 * 準備のために要るものだけを、名前で挙げて許す。
 */
export const ALLOWED_ACTIONS: readonly string[] = [
	'nimbus.locateClaude',
	'nimbus.openClaudeInstall',
	'nimbus.claudeLogin',
	'nimbus.recheckSetup',
	'nimbus.runSetupWizard',
	'nimbus.openEnvCheck',
	'vscode.openFolder',
	'workbench.trust.manage'
];

export function isAllowedAction(command: string): boolean {
	return ALLOWED_ACTIONS.includes(command);
}

/** 課金モードの言いかた。`billingModeLabel` と同じ判断をここでも使う */
function billingLabel(apiKeySource: string): string {
	return apiKeySource === 'oauth' || apiKeySource === 'none'
		? 'サブスク利用（利用上限を消費）'
		: 'API キー利用（従量課金）';
}

/**
 * いま足りていないものを並べる。**順番は直す順**。
 *
 * 実行ファイルが無ければ他は意味を持たないので先頭。
 * フォルダと信頼はその次で、課金モードは動かしてみないと分からないので最後。
 */
export function buildReadiness(input: ReadinessInput): ReadyCheck[] {
	const where = input.remoteLabel ? `${input.remoteLabel}に` : '';
	const checks: ReadyCheck[] = [];

	checks.push(
		input.executable
			? {
				id: 'executable',
				title: 'Claude Code',
				state: 'ok',
				detail: input.executable,
				actions: [{ label: '別の場所を指定する', command: 'nimbus.locateClaude' }]
			}
			: {
				id: 'executable',
				title: 'Claude Code',
				state: 'blocked',
				// リモートに繋いでいるなら、手元に入っていても使われない
				detail: input.remoteLabel
					? `${where}見つかりません。Nimbus は${input.remoteLabel}で動いているので、Claude Code も${input.remoteLabel}に要ります（手元に入っていても使われません）。`
					: '見つかりません。入れるか、置いてある場所を指定してください。',
				actions: [
					{ label: '場所を指定する', command: 'nimbus.locateClaude' },
					{ label: '入れかたを見る', command: 'nimbus.openClaudeInstall' },
					{ label: 'もう一度さがす', command: 'nimbus.recheckSetup' }
				]
			}
	);

	checks.push(
		input.hasFolder
			? { id: 'folder', title: 'フォルダ', state: 'ok', detail: '開いています', actions: [] }
			: {
				id: 'folder',
				title: 'フォルダ',
				state: 'blocked',
				detail: '開いていません。Claude はフォルダの中で動くので、先に開いてください。',
				actions: [{ label: 'フォルダを開く', command: 'vscode.openFolder' }]
			}
	);

	// フォルダを開いていないときに信頼を聞いても意味がない
	if (input.hasFolder) {
		checks.push(
			input.trusted
				? { id: 'trust', title: '信頼', state: 'ok', detail: 'このフォルダを信頼しています', actions: [] }
				: {
					id: 'trust',
					title: '信頼',
					state: 'blocked',
					detail: '信頼していないフォルダでは実行しません。画面は開けますが、送っても走りません。',
					actions: [{ label: 'このフォルダを信頼する', command: 'workbench.trust.manage' }]
				}
		);
	}

	if (input.authError) {
		// 見つかっているのに動かないときは、**止める**。動かしてみないと分からない、ではもう無い
		checks.push({
			id: 'auth',
			title: '認証',
			state: 'blocked',
			detail: `Claude Code にログインしていないようです。（${input.authError}）`,
			actions: [
				{ label: 'ターミナルに claude login を出す', command: 'nimbus.claudeLogin' },
				{ label: 'もう一度さがす', command: 'nimbus.recheckSetup' }
			]
		});
		return checks;
	}

	checks.push(
		input.apiKeySource === undefined
			? {
				id: 'auth',
				title: '認証と課金',
				state: 'unknown',
				detail: 'まだ確かめていません。一度送ると、どちらを消費するかが出ます。',
				actions: []
			}
			: {
				id: 'auth',
				title: '認証と課金',
				state: 'ok',
				detail: billingLabel(input.apiKeySource),
				actions: []
			}
	);

	return checks;
}

/** 使い始めを止めているものの数 */
export function blockedCount(checks: readonly ReadyCheck[]): number {
	return checks.filter((check) => check.state === 'blocked').length;
}

/** 送れる状態か。`unknown` は止めない（動かしてみないと分からないので） */
export function isReady(checks: readonly ReadyCheck[]): boolean {
	return blockedCount(checks) === 0;
}

/**
 * ステータスバーに出す 1 行。
 * **足りない数を出す** — 「準備が要ります」だけだと、あと何が残っているのか分からない。
 */
export function summaryLabel(checks: readonly ReadyCheck[]): string {
	const blocked = blockedCount(checks);
	if (blocked === 0) {
		return 'Nimbus';
	}
	const first = checks.find((check) => check.state === 'blocked');
	return `Nimbus — 準備 ${blocked} 件（${first?.title ?? ''}）`;
}
