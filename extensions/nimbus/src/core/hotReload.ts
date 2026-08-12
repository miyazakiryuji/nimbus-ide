/**
 * ホットリロード連携（tasks.md T-072）。
 *
 * エージェントがコードを直したら即リロードし、**結果のスクショを自分で見て**次の修正へ進む。
 * UI の調整は「直す → 見る」を何周できるかで速さが決まる。人間が毎回シミュレータを見て
 * 「まだズレてる」と打ち返しているうちは、その周回が人間の速さに縛られる。
 *
 * ここは**回すかどうかの判断**だけを持つ（コマンドの実行は呼び出し側）。
 * 判断を誤ると無限に回り続けるので、VS Code 抜きで検証できる形にしてある。
 */

export interface HotReloadConfig {
	enabled: boolean;
	/** リロードを起こすシェルコマンド。空なら撮るだけ */
	reloadCommand: string;
	/** スクショを撮るシェルコマンド。`{file}` が出力先に置き換わる */
	screenshotCommand: string;
	/** 対象にするファイル（拡張子。空なら全部） */
	extensions: string[];
	/** 1 つの指示につき、何周まで自動で回してよいか */
	maxRounds: number;
}

export const DEFAULT_MAX_ROUNDS = 3;

/** 変更されたファイルが対象かどうか。対象外の変更で撮っても意味がない */
export function touchesWatchedFiles(changedFiles: readonly string[], extensions: readonly string[]): boolean {
	if (changedFiles.length === 0) {
		return false;
	}
	if (extensions.length === 0) {
		return true;
	}
	return changedFiles.some((file) => extensions.some((extension) => file.endsWith(extension)));
}

export type ReloadDecision =
	| { run: true }
	| { run: false; reason: 'disabled' | 'no-command' | 'not-watched' | 'max-rounds' };

/**
 * いま回してよいか。
 *
 * **上限を必ず持つ。** スクショを送る → 直す → またスクショ、は放っておくと止まらない。
 * 止め時を機械が決められない以上、回数で切るしかない。
 */
export function shouldReload(
	config: HotReloadConfig,
	changedFiles: readonly string[],
	roundsSoFar: number
): ReloadDecision {
	if (!config.enabled) {
		return { run: false, reason: 'disabled' };
	}
	if (!config.screenshotCommand.trim()) {
		return { run: false, reason: 'no-command' };
	}
	if (!touchesWatchedFiles(changedFiles, config.extensions)) {
		return { run: false, reason: 'not-watched' };
	}
	if (roundsSoFar >= Math.max(1, config.maxRounds)) {
		return { run: false, reason: 'max-rounds' };
	}
	return { run: true };
}

/**
 * `{file}` を出力先に差し替える。
 * **シェルに渡す文字列を組み立てるのはここだけ**にして、置換の抜けを 1 箇所に閉じ込める。
 */
export function buildScreenshotCommand(template: string, outputPath: string): string {
	return template.includes('{file}') ? template.split('{file}').join(outputPath) : `${template} ${outputPath}`;
}

/** リロード後にエージェントへ渡す指示。何を見てほしいのかを明示する */
export function reloadPrompt(round: number, maxRounds: number): string {
	return [
		`リロード後の画面です（${round} / ${maxRounds} 周目）。`,
		'意図したとおりになっているかを画像で確認してください。',
		'ズレていれば直してください。問題なければ「完了」とだけ答えて、それ以上直さないでください。'
	].join('\n');
}
