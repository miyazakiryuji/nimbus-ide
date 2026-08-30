/**
 * 敵対的試験（T-345 / adv-02）— 手書きの設定が型を外しても、承認ルールの一覧は開く。
 *
 * ## 何を疑っているか
 *
 * 承認ルールは「手で読めて手で直せる形」を売りにしているのに、読み出しの型は**注釈だけ**
 * （`extensions/nimbus/src/permissionRules.ts:15-17` の `get<string[]>('permissions.alwaysAllow')`）。
 * 設定ファイルは人が手で書ける以上、配列に数値・null・オブジェクトが混ざりうる。
 * `nimbus.permissions.alwaysAllow` の schema は `items: { type: 'string' }` だが、
 * VS Code は配列の**要素の型までは間引かない**ので、そのまま拡張へ届く。
 *
 * ## なぜ落ちうるか
 *
 * 一覧は `viewRules`（`extensions/nimbus/src/core/permissionRules.ts:69-70`）を通り、その中で
 * `parseRule`（`extensions/nimbus/src/core/approvalRules.ts:96-97`）が `text.trim()` を呼ぶ。
 * 文字列でない 1 本で TypeError になり、`editPermissionRules`（`permissionRules.ts:66-89`）の
 * クイックピックが**一度も開かない**。溜まった自動許可を点検する手段が、型違いの 1 バイトで消える。
 * しかも例外はピッカーではなく**通知にしか出ない**ので、証拠として通知も控える。
 *
 * ## 期待する振る舞い（決めてある仕様）
 *
 * 読めない行は落とすのではなく「書式が読めません」として並べる
 * （`permissionRules.ts:73` が既にその `detail` を持っている）。だから期待は
 * 「開いて、まともな行がその説明つきで並び、読めない行はその旨で並ぶ」。
 *
 * 実セッション（課金）は要らない — この機能は設定しか読まない。
 * 根拠: `extensions/nimbus/src/permissionRules.ts:15-17, 66, 71-73, 94` /
 * `extensions/nimbus/src/core/permissionRules.ts:16-25, 69-70` /
 * `extensions/nimbus/src/core/approvalRules.ts:96-97` /
 * `extensions/nimbus/src/extension.ts:486-495` / 既存ケース `cases/21-permission-rules.mjs`
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, notificationText, quickPickText, runCommand } from '../helpers.mjs';

/** 手で書き間違えた設定。文字列 2 本のあいだに、型を外した 3 本を挟む */
const POISON = ['Bash(npm test)', 123, null, { tool: 'Read' }, 'Read'];

/**
 * まともな 1 本が**ルールとして読めた**ことの印（`core/permissionRules.ts:16-25` の `explainRule`）。
 *
 * 生の `Bash(npm test)` を探してはいけない — 読めない行の `detail`
 * 「書式が読めません（Read / Write(*.md) / Bash(npm test)）」にも同じ文字列が入っているので、
 * **毒しか並んでいなくても緑になる**。説明のほうは正しく parse できた行にしか出ない。
 */
const EXPLAINED = 'Bash のうち「npm test」で始まるものを確認せず許可';

/** クイックピックのタイトル行（`.quick-input-title`）。開いていなければ空文字 */
async function pickerTitle(page) {
	return page.evaluate(() => {
		const widget = document.querySelector('.quick-input-widget');
		if (!widget || widget.style.display === 'none') {
			return '';
		}
		return (widget.querySelector('.quick-input-title')?.innerText ?? '').trim();
	});
}

/**
 * `editPermissionRules` は `for(;;)` で回るので、閉じたことを見ながら Escape を押す。
 * 押しっぱなしにせず、閉じたら止める（余分な Escape が後続の面に効かないように）。
 */
async function closePicker(page, { attempts = 3 } = {}) {
	for (let i = 0; i < attempts; i++) {
		if (!(await quickPickText(page))) {
			return true;
		}
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);
	}
	return !(await quickPickText(page));
}

export default {
	name: '手書きの設定が型を外しても、承認ルールの一覧は開く',
	adversarial: true,
	async run(page, ctx) {
		const settingsPath = join(ctx.workspace, '.vscode', 'settings.json');
		try {
			mkdirSync(join(ctx.workspace, '.vscode'), { recursive: true });
			writeFileSync(
				settingsPath,
				JSON.stringify({ 'nimbus.permissions.alwaysAllow': POISON }, null, 2)
			);
			// 設定を読み直させる（開き直さずに効かせる。2500ms は case 21 の実測）
			await page.waitForTimeout(2500);

			await runCommand(page, labels('command.editPermissionRules')[0]);

			// **タイトルが描けるまで待つ。** コマンドパレットにはタイトルが無いので、
			// これが出た時点で「editPermissionRules のピッカーが開いた」と言える。
			// 毒で死んでいるときは最大 6 秒使い切ってから赤にする（1 回読みだと遅いだけで落ちる）
			let title = '';
			for (let i = 0; i < 12 && !title; i++) {
				await page.waitForTimeout(500);
				title = await pickerTitle(page);
			}

			const picker = await quickPickText(page);
			// **例外で死ぬとピッカーは空文字になり、理由は通知にしか出ない。** 先に控える
			const notice = await notificationText(page);
			await ctx.shot('adv-02-settings-rule-types').catch(() => undefined);

			// 行は選ばない・「ルールを足す」も押さない（どちらも modal の確認に至る）
			if (!(await closePicker(page))) {
				console.log('  ！ adv-02: クイックピックが閉じきらなかった（Escape 3 回）');
			}

			const evidence =
				`置いたのは ${POISON.length} 件（${JSON.stringify(POISON)}）\n` +
				`タイトル:「${title}」\nピッカー:\n${picker.slice(0, 500)}\n通知:\n${notice.slice(0, 500)}`;

			// 1) タイトルが描けているか（例外で死ぬと title も picker も空文字になる）
			const counted = /確認せずに許可するルール（(\d+) 件）/.exec(title || picker);
			ctx.expect(
				counted !== null,
				`ルール一覧が開いていない（タイトルが描けていない）。型違いの 1 本で落ちた疑い。\n${evidence}`
			);

			// 2) 毒が拡張まで届いたか。届いていないならこの経路では再現しない、と明示して落とす
			ctx.expect(
				counted[1] === String(POISON.length),
				`型崩れが拡張まで届いていない＝この経路では再現しない。` +
					` タイトルは「${counted[0]}」（${counted[1]} 件）。設定の読み込みが型で間引いている可能性がある。\n${evidence}`
			);

			// 3) まともな行が「何を許すのか」つきで並ぶ（生の書式だけだと毒の detail で緑になる）
			ctx.expect(
				picker.includes(EXPLAINED),
				`読める書式の行が一覧に出ていない: 「${EXPLAINED}」が無い` +
					`（生の Bash(npm test) は読めない行の detail にも入るので証拠にならない）。\n${evidence}`
			);

			// 4) 読めない行は落とさず「書式が読めません」として並ぶ（permissionRules.ts:73）
			ctx.expect(
				picker.includes('書式が読めません'),
				`型を外した行が「書式が読めません」として並んでいない（黙って捨てられた疑い）。\n${evidence}`
			);
		} finally {
			// ここで ctx.expect を投げない（本来の失敗理由が消える）。失敗は console.log で言う
			await page.keyboard.press('Escape').catch(() => undefined);
			// このケースは**コマンドが落ちるのが期待の裏側**なので、失敗時はエラーの通知が居座る。
			// 次のケース（通知を読む adv-07 など）へ持ち越さないよう、その場で畳む
			try {
				for (const button of await page.$$('.notifications-toasts .codicon-notifications-clear')) {
					await button.click();
					await page.waitForTimeout(150);
				}
			} catch (error) {
				console.log(`  ！ adv-02: 通知を畳めませんでした（${error instanceof Error ? error.message : String(error)}）`);
			}
			// 毒を残さない。次のケースは同じワークスペースを使う
			try {
				rmSync(settingsPath, { force: true });
			} catch (error) {
				console.log(`  ！ adv-02: 設定を消せませんでした（${error instanceof Error ? error.message : String(error)}）`);
			}
			// 設定の消え際を跨ぐ（書き込み直後と同じだけ待つ）
			await page.waitForTimeout(1500);
		}
	}
};
