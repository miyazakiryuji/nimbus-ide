/**
 * コピーしたエラー文を拾って「調べますか？」と聞く（tasks.md T-170）。
 *
 * エラーが出たとき、人はまずエラー文をコピーする。そこから検索したり、
 * エージェントに貼ったりする。**貼る手間だけを省く。**
 *
 * ただしクリップボードは、パスワードも個人情報も通る場所。
 * だから既定は**無効**で、有効にしても「エラー文らしいもの」以外には反応しない。
 *
 * VS Code に依存しない。判断だけを置く。
 */
import { parseStackTrace } from './stackTrace';

/** 短すぎる／長すぎるものは相手にしない（1 語のコピーや、ファイル丸ごとの貼り付け） */
const MIN_LENGTH = 20;
const MAX_LENGTH = 20000;

/** エラーだと言い切れる目印。曖昧なものは入れない */
const ERROR_MARKERS = [
	/\bTraceback \(most recent call last\)/,
	/\b[A-Z][A-Za-z]*(?:Error|Exception)\b\s*:/,
	/^\s*at\s+\S+\s*\(.*:\d+:\d+\)/m,
	/\bpanic:\s/,
	/\bFAILED\b/,
	/\bfatal error:/i,
	/\berror(?:\[E\d+\])?:\s/i,
	/\bUnhandled exception\b/i
];

/**
 * エラー文らしいか。
 * **迷ったら反応しない。** 関係ないコピーのたびに聞かれると、通知ごと切られる。
 */
export function looksLikeError(text: string): boolean {
	const trimmed = text.trim();
	if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
		return false;
	}
	if (ERROR_MARKERS.some((marker) => marker.test(trimmed))) {
		return true;
	}
	// 目印が無くても、スタックトレースとして読めれば十分な手がかり
	return parseStackTrace(trimmed).length >= 2;
}

/** 通知に出す一行。**中身は出さない**（クリップボードの内容を画面に晒さない） */
export function hintHeadline(text: string): string {
	const lines = text.trim().split('\n').length;
	return `コピーした内容がエラーのようです（${lines} 行）。調べますか？`;
}

/** セッションへ投入する文 */
export function buildClipboardPrompt(text: string): string {
	return [
		'コピーしたエラーです。原因を調べて直してください。',
		'',
		'````',
		text.trim(),
		'````',
		'',
		'まず何が起きているかを説明してから、修正に入ってください。'
	].join('\n');
}
