/**
 * 敵対的試験（T-345）— 空と欠け: 読めない `.claude/settings.json` を、空とみなして上書きしない。
 *
 * **疑っている壊れかた** — `readSettings` は readFile の失敗と JSON.parse の失敗を**同じ catch**
 * で受けて `{}` を返す（`extensions/nimbus/src/hooksBuilder.ts:36-45`）。読めなかったのか、
 * 中身が壊れていたのかを区別しないまま「空だった」ことにする。
 * そのあとの `writeHooks` は `{ ...settings }` に hooks を載せて丸ごと書き直すだけなので
 * （`hooksBuilder.ts:141-150`）、**読めなかった 1 回で既存の `permissions` / `env` が消える**。
 * しかも mode 222（書けるが読めない）では書き込み自体は成功するため失敗の合図が出ず、
 * 「Nimbus: フックを保存しました。」と言い切る（`hooksBuilder.ts:126-131`）。黙ったデータ消失。
 *
 * **期待する振る舞い** — 読めないときは書かずに理由を言う。**少なくとも既存の内容を保つ。**
 * ※「壊れた JSON は空から始める」は `hooksBuilder.ts:41` のコメントで意図的に決めてある。
 * EACCES を別扱いにすべきという主張は仕様書に無いので、ここが落ちたときは「不具合」ではなく
 * **決めていないことの提起**として扱う。
 *
 * 根拠: `extensions/nimbus/src/hooksBuilder.ts:36-45, 126-131, 141-150` /
 * 既存ケース `cases/23-hooks.mjs:14-22`（QuickPick の送りかたはここから写した） /
 * 実測（uid 501・mode 222 は read が EACCES・write は成功）
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, notificationText, runCommand } from '../helpers.mjs';

/** QuickPick / InputBox が出るのを待ってから打つ（23-hooks.mjs:14-22 と同じ） */
async function typeAndEnter(page, text, { delay = 900 } = {}) {
	await page.waitForTimeout(delay);
	if (text) {
		await page.keyboard.type(text, { delay: 20 });
		await page.waitForTimeout(400);
	}
	await page.keyboard.press('Enter');
}

export default {
	name: '読めない .claude/settings.json を、空とみなして上書きしない',
	adversarial: true,
	async run(page, ctx) {
		const settingsPath = join(ctx.workspace, '.claude', 'settings.json');
		// 消えたら分かる印を 2 つ置く。`keep-me` は env 側（hooks とは無関係な既存の設定）
		const original = `${JSON.stringify(
			{ permissions: { allow: ['Read(*.md)'] }, env: { NIMBUS_GUI: 'keep-me' } },
			null,
			2
		)}\n`;

		try {
			mkdirSync(join(ctx.workspace, '.claude'), { recursive: true });
			writeFileSync(settingsPath, original, 'utf8');
			// **ファイルだけ** 222（書けるが読めない）。ディレクトリの権限は絶対に触らない —
			// 000 にすると `git clean -qffdx` が入れず、以後の全ケースが壊れる
			chmodSync(settingsPath, 0o222);
			const stamp = statSync(settingsPath).mtimeMs;

			// 先に出ている通知を控えておく。「保存しました」が**前のケースの残り**だったときに
			// 下の関門が偽で通ってしまうのを防ぐ
			const toastBefore = await notificationText(page);

			// runCommand は真偽を返さない（実行できたかは、書かれた設定で判断する）
			await runCommand(page, labels('command.hooks')[0]);
			// 1) 「フックを足す」を選ぶ（読めない ＝ 既存 0 件と見なされるので一覧の先頭）
			await typeAndEnter(page, 'フックを足す', { delay: 1200 });
			// 2) タイミング（PreToolUse は matcher を聞かれる種類）
			await typeAndEnter(page, 'PreToolUse');
			// 3) どのツールに効かせるか
			await typeAndEnter(page, 'Bash');
			// 4) 走らせるコマンド
			await typeAndEnter(page, 'exit 2');

			// 書き込みは非同期。中身は読めないので **mtime** で「書かれた」を待つ
			for (let i = 0; i < 14; i++) {
				await page.waitForTimeout(500);
				let now;
				try {
					now = statSync(settingsPath).mtimeMs;
				} catch {
					break; // 消された（それ自体は下の判定で出る）
				}
				if (now !== stamp) {
					break;
				}
			}
			// 通知は書き込みが済んだ**あと**に出る。mtime が変わった瞬間に読むと
			// まだ描かれておらず、失敗時の文言から「保存しました」が消える
			await page.waitForTimeout(700);
			const toastAfter = await notificationText(page);

			// 権限を戻してから読み直す（ここで初めて中身が見える）。
			// **消されていたら chmod は ENOENT で落ちる** — ここで例外にすると
			// 「消えた」という肝心の結果が ENOENT の文言に化けるので、握って先へ進む
			const stillThere = existsSync(settingsPath);
			if (stillThere) {
				try {
					chmodSync(settingsPath, 0o644);
				} catch (error) {
					console.log(`  ！ 読み直すための chmod に失敗しました: ${error?.message ?? error}`);
				}
			}
			let written = '';
			try {
				written = stillThere ? readFileSync(settingsPath, 'utf8') : '';
			} catch (error) {
				console.log(`  ！ settings.json を読み直せませんでした: ${error?.message ?? error}`);
			}
			await ctx.shot('adv-08-unreadable-settings');

			// --- 偽の緑を潰す関門 ---
			// QuickPick が 1 段でもずれると何も書かれず、`keep-me` が残って全部通ってしまう。
			// 「フックの流れが最後まで走った」ことを先に確かめる
			const savedToastIsNew = toastAfter.includes('保存') && !toastBefore.includes('保存');
			// 置いたファイルが**消えている**のも「流れが走った」証拠（しかも最悪の結果）。
			// ここで止めずに、下の本命へ落として「消えた」として報告させる
			ctx.expect(
				written.includes('PreToolUse') || savedToastIsNew || !stillThere,
				'フックの流れが最後まで走っていない（このケースは何も確かめていない）: ' +
					`書かれた設定=${JSON.stringify(written.slice(0, 300))} / ` +
					`通知（後）=${JSON.stringify(toastAfter.slice(0, 200))} / ` +
					`通知（前）=${JSON.stringify(toastBefore.slice(0, 200))}`
			);

			// --- 本命 ---
			// 読めなかったのだから、書かないか、書くにしても既存を残すか、どちらか。
			// 書き込み自体が権限で撥ねられた場合（＝消失なし）も、ここは緑になる
			ctx.expect(
				written.includes('keep-me'),
				'読めない settings.json を空とみなして上書きし、既存の env / permissions が消えた: ' +
					`置いた内容=${JSON.stringify(original.replace(/\s+/g, ' ').slice(0, 160))} / ` +
					`いまの内容=${stillThere ? JSON.stringify(written.replace(/\s+/g, ' ').slice(0, 300)) : '（ファイルごと消えた）'} / ` +
					`通知=${JSON.stringify(toastAfter.slice(0, 200))}`
			);
		} finally {
			// 読めない・消せないファイルを置き去りにすると、以後の `resetWorkspace` と
			// 他のケースを巻き込む。**必ず** 644 へ戻してから消す。
			// finally の中では ctx.expect を投げない（本来の失敗理由が消える）
			try {
				// 既に消えているなら戻すものが無い（ENOENT の空騒ぎを出さない）
				if (existsSync(settingsPath)) {
					chmodSync(settingsPath, 0o644);
				}
			} catch (error) {
				console.log(`  ！ settings.json の権限を戻せませんでした: ${error?.message ?? error}`);
			}
			try {
				rmSync(settingsPath, { force: true });
			} catch (error) {
				console.log(`  ！ settings.json を消せませんでした: ${error?.message ?? error}`);
			}
			if (existsSync(settingsPath)) {
				console.log(`  ！ settings.json が残っています: ${settingsPath}`);
			}
		}
	}
};
