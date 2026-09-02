/**
 * 敵対的試験（T-379 / adv-19）— 打ちかけの本文は、敵意のある文字でも大きくても、閉じて開いたら一字も欠けない。
 *
 * ## 何を疑っているか
 *
 * 打ちかけは `vscode.setState({ draftText })` で覚える（`media/cockpit.js` の `rememberDraftText`・T-376）。
 * ケース 71 は短い日本語 1 行しか通していない。**保存 → 終了 → 読み直し**の経路で化けうるのは
 * 改行（CRLF）・タブ・引用符と `\\`・HTML のかけら・RTL 制御文字（U+202E）・ZWJ つきの絵文字・
 * そして**大きさ**（ログを貼り付けた 120KB）。webview の state は workbench の保存領域に JSON で
 * 入るので、大きさに実質の上限があるなら**黙って切れる**か、**丸ごと戻らない**。
 *
 * ## 期待する振る舞い
 *
 * `input.value` が閉じる前と**一字も違わない**（長さ・先頭・差分位置で言う）。HTML のかけらが
 * どこにも要素として現れない（textarea の値は描画されないが、念のため）。
 *
 * ## 手順の要点
 *
 * 値を代入して `input` イベントを送る（打鍵の配線はケース 71 が見ている。ここは大きさと文字が主眼）。
 * 毒が届いたことは、代入直後の `input.value` が一致することで先に確かめる。
 */
import { openNimbusSidebar } from '../helpers.mjs';

async function cockpitFrame(page, { attempts = 30 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#input')) {
					return frame;
				}
			} catch {
				// フレームが入れ替わっている最中
			}
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

function hostileText() {
	const head = [
		'<img src=x onerror=alert(1)> <script>void 0</script>',
		"引用 ' \" ` と \\ バックスラッシュ\tタブ",
		'‮右から左‬ 👨‍👩‍👧‍👦 🇯🇵 ﾊﾝｶｸ',
		'CRLF\r\nの行\r\n',
		'  先頭と末尾の空白  '
	].join('\n');
	// 120KB のログの貼り付けを模す（1 行 60 字 × 2,000 行）
	const line = 'error: ENOENT no such file /var/tmp/x/y/z/build/out/main.js\n';
	return head + '\n' + line.repeat(2000);
}

function firstDiff(a, b) {
	const n = Math.min(a.length, b.length);
	for (let i = 0; i < n; i++) {
		if (a[i] !== b[i]) {
			return i;
		}
	}
	return a.length === b.length ? -1 : n;
}

export default {
	name: '打ちかけの本文は、敵意のある文字でも 120KB でも、閉じて開いたら一字も欠けない',
	adversarial: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		let frame = await cockpitFrame(page);
		ctx.expect(frame !== undefined, 'コックピットの入力欄が見つからない');
		const text = hostileText();
		try {
			/*
			 * textarea は CRLF を LF に**正規化する**（実測: 置いた直後の `value` が元と一致しない）。
			 * 比べる相手は「置いた直後に読み返した値」— 保存 → 終了 → 読み直しで化けたかどうかが主眼
			 */
			const placed = await frame.evaluate((value) => {
				const input = document.getElementById('input');
				input.value = value;
				input.dispatchEvent(new Event('input', { bubbles: true }));
				return input.value;
			}, text);
			ctx.expect(
				placed.length > 100_000 && placed.includes('<img src=x') && placed.includes('‮'),
				`入力欄へ値を置けなかった（長さ ${placed.length}）。この先は何も確かめていない`
			);
			await page.waitForTimeout(600);

			const reopened = await ctx.restart();
			ctx.expect(await openNimbusSidebar(reopened), '開き直したあと Nimbus のサイドバーを開けない');
			frame = await cockpitFrame(reopened);
			ctx.expect(frame !== undefined, '開き直したあとコックピットの入力欄が見つからない');
			const restored = await frame.evaluate(() => document.getElementById('input').value);
			const at = firstDiff(placed, restored);
			ctx.expect(
				at === -1,
				`打ちかけが化けた: 長さ ${placed.length} → ${restored.length}、最初の違いは ${at} 文字目 ` +
					`「${JSON.stringify(placed.slice(Math.max(0, at - 10), at + 20))}」→「${JSON.stringify(restored.slice(Math.max(0, at - 10), at + 20))}」`
			);
			// `script:not([src])` は面自身の inline script（nonce つき）に当たる（実測）。見るのは毒の img だけ
			const injected = await frame.evaluate(() => Boolean(document.querySelector('img[src="x"]')));
			ctx.expect(!injected, 'HTML のかけらが要素として面に現れた');
			await ctx.shot('adv-19-draft-text-hostile');
		} finally {
			// 打ちかけを空にして次のケースへ持ち越さない（reset も捨てるが、二重に守る）
			await frame?.evaluate(() => {
				const input = document.getElementById('input');
				input.value = '';
				input.dispatchEvent(new Event('input', { bubbles: true }));
			}).catch(() => undefined);
		}
	}
};
