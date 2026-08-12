/**
 * OS 通知（tasks.md T-019）。
 *
 * 「放置して他の作業に戻れる」ことがこの製品の体験の芯なので、終わったことが
 * **ウィンドウを見ていなくても**届く必要がある。VS Code の通知はウィンドウの中にしか出ない。
 *
 * 文字列をシェルに組み立てて渡すと、タスク名に `"` が入っただけで壊れる（最悪、実行される）。
 * そのため **引数として渡す形だけ**を組み立てる — この関数はコマンドと argv を返すだけで、
 * 起動は呼び出し側が `spawn`（シェル無し）で行う。
 */

export interface NotifyCommand {
	command: string;
	args: string[];
}

/**
 * プラットフォームごとの通知コマンドを組み立てる。
 * 対応できないプラットフォームでは `undefined` を返し、呼び出し側が
 * VS Code のウィンドウ内通知に落とす。
 *
 * macOS は `osascript` の `on run argv` を使い、本文をスクリプト文字列に**埋め込まない**。
 * これで引用符・改行・バックスラッシュが混ざっても壊れない。
 */
export function buildNotifyCommand(platform: NodeJS.Platform, title: string, body: string): NotifyCommand | undefined {
	switch (platform) {
		case 'darwin':
			return {
				command: 'osascript',
				args: [
					'-e',
					'on run argv',
					'-e',
					'display notification (item 1 of argv) with title (item 2 of argv)',
					'-e',
					'end run',
					// osascript は `--` の後ろを argv として渡す
					'--',
					body,
					title
				]
			};
		case 'linux':
			return { command: 'notify-send', args: ['--app-name=Nimbus', title, body] };
		default:
			// Windows は PowerShell へスクリプト文字列を渡す形になり、埋め込みを避けられない。
			// 壊れる余地を残すくらいならウィンドウ内通知に落とす
			return undefined;
	}
}

/** 通知の本文は 1 行に畳む。複数行のまま渡すと OS 側で切られ方が読めない */
export function oneLine(text: string, limit: number = 120): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}
