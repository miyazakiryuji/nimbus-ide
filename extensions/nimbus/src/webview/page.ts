/**
 * Webview の HTML を組み立てる。
 *
 * **Content-Security-Policy をここ 1 か所で決める**のが主な目的。
 * 各ビューが自分で書いていると、片方だけ緩めても誰も気づけない。
 * 外部への接続は一切許さず、スクリプトは nonce 付きの同梱ファイルだけを許す。
 */
import type * as vscode from 'vscode';
import { createNonce } from './nonce';

export interface WebviewPage {
	webview: vscode.Webview;
	title: string;
	stylesheet: vscode.Uri;
	script: vscode.Uri;
	/** `<body>` に付ける属性（例: `data-assistant="ゆあ"`） */
	bodyAttributes?: string;
	/** `<body>` の中身 */
	body: string;
}

export function renderWebviewPage(page: WebviewPage): string {
	const nonce = createNonce();
	const attributes = page.bodyAttributes ? ` ${page.bodyAttributes}` : '';
	return `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta http-equiv="Content-Security-Policy"
		content="default-src 'none'; style-src ${page.webview.cspSource}; script-src 'nonce-${nonce}';">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<link href="${page.stylesheet}" rel="stylesheet">
	<title>${page.title}</title>
</head>
<body${attributes}>
${page.body}
	<script nonce="${nonce}" src="${page.script}"></script>
</body>
</html>`;
}
