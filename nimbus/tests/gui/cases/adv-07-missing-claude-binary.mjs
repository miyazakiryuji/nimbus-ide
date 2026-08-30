/**
 * adv-07（T-345・敵対的試験 / 守っている修正: T-350）— 存在しない Claude Code を指しても
 * 「準備は揃っています」と言わない。
 *
 * **疑っているのは「設定に書いてあれば在ることにする」経路。**
 * `resolveClaudeExecutable()` は、他の 2 経路（同梱バイナリ・PATH と既知のディレクトリ）では
 * どちらも `existsSync` と実行権（`accessSync(X_OK)`）を見ているのに、
 * 設定 `nimbus.claudeCodeExecutable` にパスがあるときだけ **`configured.trim()` をそのまま返す**
 * （`extensions/nimbus/src/claudeExecutable.ts:68-72`）。
 *
 * だから、実在しない絶対パスを 1 行書くだけで
 * `buildReadiness` の `input.executable` が真になり（`extensions/nimbus/src/core/readiness.ts:120-129`）、
 * 準備は blocked 0 ＝ ステータスバーの警告も消え（`extensions/nimbus/src/extension.ts:3153-3167`）、
 * 送信前チェック（`extensions/nimbus/src/extension.ts:3426`）も素通りして SDK の英語エラーまで進む。
 * 「本当に使えるか」を確かめる `locateClaude` も同じ関数を使うので（`setupActions.ts:41-47`）、
 * **確認のほうも一緒に嘘をつく。**
 *
 * 期待する振る舞い: 実在しない**絶対パス**を指した時点で blocked。
 * 通知は「Nimbus — 準備 1 件（Claude Code）」、ステータスバーに警告。
 * 「準備は揃っています。」とは言わない。
 * ※ 設定値が `claude` のような**コマンド名**なのは正当（PATH 解決に任せる）。
 *   ここが落ちたときの直しかたも「絶対パスのときだけ実在と実行権を確かめる」に限る。
 *
 * 触らないもの: 準備カードの `.readiness-action`（先頭が `nimbus.locateClaude` →
 * `showOpenDialog` のネイティブモーダル・`setupActions.ts:27`）。出た瞬間に束が丸ごと死ぬ。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { notificationText, runCommand } from '../helpers.mjs';

/**
 * `nimbus.recheckSetup` のタイトル。**nls を通していない素の日本語**なので
 * （`extensions/nimbus/package.json:1261-1262`）、`labels()` では引けない。生文字列で渡す。
 */
const RECHECK = '準備をもう一度さがす';

/**
 * コア側の「通知をすべて消す」。日本語 UI でも英語の別名で引ける
 * （`commandsQuickAccess.ts:244-250` が `category: 原文` を `commandAlias` にする）。
 */
const CLEAR_TOASTS = 'Notifications: Clear All Notifications';

/** ステータスバーの表示文字（06-status-bar.mjs と同じ掴みかた） */
async function statusBarText(page) {
	return page.evaluate(() => document.querySelector('.part.statusbar')?.innerText ?? '');
}

/**
 * トーストが本当に消えるまで待つ。消えたら空文字、残っていればその中身を返す。
 *
 * 「消す命令を打った」ことと「消えた」ことは違う。押した直後は消える途中なので、
 * 固定時間で待つと**残っている 1 枚を掴む日と掴まない日**ができる。
 */
async function toastsLeft(page, { attempts = 6 } = {}) {
	for (let i = 0; i < attempts; i++) {
		const left = await notificationText(page);
		if (left.trim() === '') {
			return '';
		}
		await page.waitForTimeout(250);
	}
	return notificationText(page);
}

/**
 * トーストを空にしてから「準備をもう一度さがす」を打ち、**そのとき出た通知だけ**を読む。
 *
 * `notificationText` は出ている全トーストを連結するので、前の分が残っていると
 * 「揃っていますと言っていない」という**否定形の判定が汚れる**（言っていないのに落ちる／
 * 言っているのに緑になる、の両方が起きる）。
 * だから**消えたことを見てから**打つ。消え残っていたら 1 度だけ押し直す。
 */
async function recheck(page) {
	await runCommand(page, CLEAR_TOASTS);
	if (await toastsLeft(page)) {
		await runCommand(page, CLEAR_TOASTS);
		await toastsLeft(page);
	}
	await runCommand(page, RECHECK);
	await page.waitForTimeout(700);
	return notificationText(page);
}

/** 読みやすい 1 行にする（通知は改行を含む） */
function oneLine(text, max = 220) {
	return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export default {
	name: '存在しない Claude Code を指しても「準備は揃っています」と言わない',
	adversarial: true,
	async run(page, ctx) {
		const settingsDir = join(ctx.workspace, '.vscode');
		const settingsPath = join(settingsDir, 'settings.json');
		// **このファイルは作らない。** 実在しない絶対パスであることがケースの前提
		const missing = join(ctx.workspace, 'no-such-claude');

		try {
			// 0. 壊す前に基準を取る。
			//    Claude Code が入っていない機械では素で blocked なので、
			//    ここを確かめずに進むと「壊す前から赤い」＝何も証明しない素通りの緑になる
			const before = await recheck(page);
			ctx.expect(
				before.includes('準備は揃っています'),
				`壊す前の基準が取れない（この機械では準備がもともと揃っていない）。壊す前の通知: "${oneLine(before)}"`
			);

			// 1. 実在しない絶対パスを指す。設定の変更は `affectsConfiguration` で拾われて
			//    その場で準備が組み直される（extension.ts:4236-4238）
			mkdirSync(settingsDir, { recursive: true });
			writeFileSync(
				settingsPath,
				JSON.stringify({ 'nimbus.claudeCodeExecutable': missing }, null, 2)
			);
			await page.waitForTimeout(2500);

			// 2. 通知とステータスバーを、判定の前にまとめて読む（失敗の文面に実測値を入れるため）
			const after = await recheck(page);
			const status = await statusBarText(page);
			await ctx.shot('adv-07-missing-claude-binary');

			// 3-0. 偽の緑を潰す。パレットが開かないなどで recheck が走らないと通知は空になり、
			//      「揃っていますと言っていない」という否定形の判定（3-1）は**素通りする**。
			//      どちらの答えも `Nimbus:` で始まるので、答えたこと自体を先に確かめる
			ctx.expect(
				after.includes('Nimbus'),
				`「準備をもう一度さがす」が何も答えていない（このケースは何も確かめていない）。通知: "${oneLine(after)}"`
			);
			// 3-1. 無いものを「揃っている」と言わない（これが本命）
			ctx.expect(
				!after.includes('準備は揃っています'),
				`実在しない絶対パス（${missing}）を指しているのに「準備は揃っています」と言っている。通知: "${oneLine(after)}"`
			);
			// 3-2. 何が足りないのかを名指しする（黙って blocked にするだけでは直せない）
			ctx.expect(
				after.includes('Claude Code') || after.includes('準備 1 件'),
				`足りない項目（Claude Code）を通知が名指ししていない。通知: "${oneLine(after)}"`
			);
			// 3-3. 面を開いていなくても気づける（ステータスバーの警告）
			ctx.expect(
				status.includes('準備') && status.includes('Claude Code'),
				`ステータスバーに準備の警告が出ていない。ステータスバー: "${oneLine(status)}"`
			);
		} finally {
			// 後始末は必ずここで。ctx.expect の後ろに書いた行は、落ちたときに実行されない。
			// finally の中で ctx.expect は投げない（本来の失敗理由が消える）
			try {
				rmSync(settingsPath, { force: true });
				rmSync(settingsDir, { recursive: true, force: true });
				await page.waitForTimeout(2500);
				// 消して元に戻ったことまで見る。戻らないなら、次のケースが汚れた設定を拾う
				const restored = await recheck(page);
				if (!restored.includes('準備は揃っています')) {
					console.log(`      ！ 設定を消しても準備が戻っていません: "${oneLine(restored, 160)}"`);
				}
				// 出しっぱなしのトーストを次のケースへ持ち越さない
				await runCommand(page, CLEAR_TOASTS);
			} catch (error) {
				console.log(
					`      ！ adv-07 の後始末に失敗しました: ${error instanceof Error ? error.message : String(error)}`
				);
			}
		}
	}
};
