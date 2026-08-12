/**
 * 課金モードの表示。
 *
 * 「今の実行が何を消費しているのか」は、利用者がいちばん誤解しやすく、
 * かつ誤解したときの損害が大きい情報なので、常に見える場所に出す。
 *
 * `apiKeySource` は Claude Code の init メッセージが返す「API キーの出所」。
 * 型定義上の enum は 'user' | 'project' | 'org' | 'temporary' | 'oauth' だが、
 * **実測ではキーを使っていないとき（＝サブスクの OAuth ログイン）に 'none' が届く**。
 * 旧 Electron 版では、これを従量課金と誤表示していたのをスクリーンショット検品で発見した。
 */

export function billingModeLabel(apiKeySource: string | undefined): string {
	if (apiKeySource === undefined) {
		return '接続未確認';
	}
	if (apiKeySource === 'oauth' || apiKeySource === 'none') {
		return 'サブスク利用（利用上限を消費）';
	}
	return 'API キー利用（従量課金）';
}
