/**
 * ワンクリック導入（tasks.md T-071）。
 *
 * 他の人の環境を**そのまま試す**ための入口。中身は T-043 の配布物と同じで、
 * 違うのは「URL から取ってくる」ところだけ。
 *
 * 他ツールの指示書の取り込み（T-068）は `core/importRules.ts` にある
 * （別セッションの実装。glob 探索・`.mdc` 対応・マルチルート対応まで入っているので、
 * こちらの版は捨ててそちらへ寄せた）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * 受け取ってよい URL か。
 * **`https` だけ**を通す。`file:` や `http:` を通すと、
 * 「リンクを押しただけ」で意図しないものが入る経路になる。
 */
export function checkBundleUrl(raw: string): UrlCheck {
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, reason: 'URL として読めません' };
	}
	if (url.protocol !== 'https:') {
		return { ok: false, reason: `https だけを受け付けます（受け取ったもの: ${url.protocol}）` };
	}
	return { ok: true, url: url.toString() };
}
