/**
 * リモートに繋いでいるときの案内（tasks.md T-084）。
 *
 * 調査（`nimbus/docs/history/remote-dev-investigation.md`）で分かったこと:
 * **Nimbus の拡張は既定でリモート側（workspace 側）で動く。**
 * つまり `claude` を探すのも、認証（`~/.claude`）を読むのも**繋いだ先**。
 *
 * ところが案内の文面は手元向けのままなので、
 * 「入れたのに見つからない」と言われて、**手元にもう一度入れる**ことになる。
 * 入れる場所が違うので、何度入れても直らない。ここを言い分ける。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** `vscode.env.remoteName` の値。未接続なら `undefined` */
export type RemoteName = string | undefined;

/** 繋ぎ先の呼びかた。知らないものはそのまま出す（嘘の名前を出さない） */
export function remoteLabel(remoteName: RemoteName): string | undefined {
	if (!remoteName) {
		return undefined;
	}
	switch (remoteName) {
		case 'ssh-remote':
			return 'SSH 接続先';
		case 'dev-container':
		case 'attached-container':
			return 'コンテナの中';
		case 'wsl':
			return 'WSL の中';
		case 'codespaces':
			return 'Codespaces';
		default:
			return remoteName;
	}
}

export interface MissingExecutableGuidance {
	message: string;
	/** 詳しい説明（モーダルの本文など）。手元とリモートで要点が違う */
	detail?: string;
}

/**
 * Claude Code が見つからないときの案内。
 *
 * **どこに入れるべきかを最初に言う。** リモートに繋いでいるなら、
 * 手元に入っていても意味が無い。
 */
export function missingExecutableGuidance(remoteName: RemoteName): MissingExecutableGuidance {
	const label = remoteLabel(remoteName);
	if (!label) {
		return {
			message:
				'Nimbus: Claude Code が見つかりません。'
				+ 'インストールするか、設定 nimbus.claudeCodeExecutable にパスを指定してください。'
		};
	}
	return {
		message: `Nimbus: ${label}に Claude Code が見つかりません。**繋いだ先**にインストールしてください。`,
		detail: [
			`Nimbus の拡張は${label}で動いているので、Claude Code も${label}に必要です。`,
			'手元（この PC）に入っていても使われません。',
			'',
			`設定 nimbus.claudeCodeExecutable を使うときも、パスは${label}のものを指定してください。`,
			`認証（~/.claude）も${label}のものが使われます。`
		].join('\n')
	};
}

/**
 * リモートで使うときに、先に知っておくべきこと。
 *
 * **薦める拡張は書かない。** 特定の OSS リモート拡張を名指しすると、
 * その拡張のメンテ状況を Nimbus が背負うことになる（調査の結論）。
 * 経路だけ示して、選ぶのは利用者に任せる。
 */
export function remoteReadiness(remoteName: RemoteName): string[] {
	const label = remoteLabel(remoteName);
	if (!label) {
		return [];
	}
	return [
		`Nimbus の拡張は${label}で動いています。`,
		`Claude Code の実行ファイルと認証（~/.claude）は、${label}のものが使われます。`,
		`ターミナル・テスト・git も${label}で走ります。`
	];
}
