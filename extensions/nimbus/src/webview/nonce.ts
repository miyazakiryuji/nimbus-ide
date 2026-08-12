/**
 * Webview の Content-Security-Policy に載せる nonce。
 *
 * コックピットとタスク板で同じものを使う。同じ実装が 2 つあると、
 * 片方だけ直したときに気づけない（ドクターの duplication 検査で実際に検出された）。
 */
export function createNonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return text;
}
