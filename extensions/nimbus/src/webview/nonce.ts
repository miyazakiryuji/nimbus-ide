/**
 * Webview の Content-Security-Policy に載せる nonce。
 *
 * コックピットとタスク板で同じものを使う。同じ実装が 2 つあると、
 * 片方だけ直したときに気づけない（ドクターの duplication 検査で実際に検出された）。
 *
 * **`Math.random()` は使わない。** nonce は「推測できないこと」だけが拠りどころで、
 * `Math.random()` は暗号用ではなく、いくつか観測すれば続きを言い当てられる。
 * それでは CSP に nonce を載せる意味が無くなる（T-202 のスキャナが検出した）。
 */
import { randomBytes } from 'crypto';

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const LENGTH = 32;
/**
 * 256 を文字数で割り切れる最大の境目。これ以上の値を捨てることで、
 * 剰余を取ったときに先頭の文字だけが出やすくなる偏りを無くす。
 */
const LIMIT = Math.floor(256 / CHARS.length) * CHARS.length;

export function createNonce(): string {
	let text = '';
	while (text.length < LENGTH) {
		// 捨てる分があるので、必要数より多めに引く
		for (const byte of randomBytes(LENGTH)) {
			if (byte >= LIMIT) {
				continue;
			}
			text += CHARS.charAt(byte % CHARS.length);
			if (text.length === LENGTH) {
				break;
			}
		}
	}
	return text;
}
