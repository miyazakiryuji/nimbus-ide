/**
 * 段階的リファクタの進捗（T-111）の通し確認。
 *
 * 仕様 [refactor-progress](../../../docs/specs/refactor-progress.md) の
 * 「パターンを入れて追跡を始めると、いまの件数が出る」「いくつか置き換えたあと進捗を見ると、
 * 残りが減っている」「当たらないパターンでは追跡が始まらない」がこれ。
 *
 * **実セッション（課金）は要らない。** `git grep` を叩いて数えるだけ。
 *
 * 単体テストは `git grep -c` の出力を割るところしか見ていない。
 * **実際に git を叩いて数が出るか**は、ここでしか分からない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, git, labels, notificationText, quickPickText, runCommand } from '../helpers.mjs';

async function waitForNotification(page, needle, { attempts = 14 } = {}) {
	let text = '';
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(600);
		text = await notificationText(page);
		if (text.includes(needle)) {
			return text;
		}
	}
	return text;
}

/** クイックピックに出そろうまで待つ（git grep を人数ぶん叩くので、出るまでに間がある） */
async function waitForQuickPick(page, needle, { attempts = 14 } = {}) {
	let text = '';
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(600);
		text = await quickPickText(page);
		if (text.includes(needle)) {
			return text;
		}
	}
	return text;
}

/** 入力欄に打って確定する */
async function typeAndEnter(page, text, { delay = 1000 } = {}) {
	await page.waitForTimeout(delay);
	await page.keyboard.type(text, { delay: 20 });
	await page.waitForTimeout(400);
	await page.keyboard.press('Enter');
}

/** 通知を片付けてから次の操作へ（前の文言を拾って誤判定しないように） */
async function dismiss(page) {
	await page.keyboard.press('Escape');
	await page.waitForTimeout(800);
}

export default {
	name: '置き換えの追跡が、実際の git grep から件数を出す',
	async run(page, ctx) {
		await closeAllEditors(page);

		// 3 箇所に同じ古い呼び出しを置く（git grep で数えられる形にする）
		mkdirSync(join(ctx.workspace, 'lib'), { recursive: true });
		for (const [name, times] of [['a.ts', 2], ['b.ts', 1]]) {
			writeFileSync(
				join(ctx.workspace, 'lib', name),
				Array.from({ length: times }, (_, i) => `export const v${i} = oldHelper(${i});`).join('\n') + '\n'
			);
		}
		git(ctx.workspace, ['add', '-A']);
		git(ctx.workspace, ['commit', '-m', 'before refactor']);
		await page.waitForTimeout(1200);

		// --- 当たるパターン ---
		await runCommand(page, labels('command.trackRefactor')[0]);
		await typeAndEnter(page, 'oldHelper', { delay: 1200 }); // パターン
		await typeAndEnter(page, '古い呼び出しの置き換え'); // 名前

		const started = await waitForNotification(page, '追いかけます');
		ctx.expect(
			started.includes('追いかけます'),
			`追跡開始の知らせが出ない:\n${started.slice(0, 300)}`
		);
		// **実際に数えられているか。** 3 箇所置いたので 3 が出るはず
		ctx.expect(
			started.includes('3 箇所'),
			`git grep の件数が合わない（3 箇所置いた）:\n${started.slice(0, 300)}`
		);
		await ctx.shot('refactor-track');

		// --- 1 箇所置き換えると、残りが減る ---
		// ここが仕様のいちばん大事なところ。分母は控えたまま、残りだけが動く
		await dismiss(page);
		writeFileSync(join(ctx.workspace, 'lib', 'b.ts'), 'export const v0 = newHelper(0);\n');
		git(ctx.workspace, ['add', '-A']);
		git(ctx.workspace, ['commit', '-m', 'replace one']);
		await page.waitForTimeout(1200);

		await runCommand(page, labels('command.refactorProgress')[0]);
		const progress = await waitForQuickPick(page, '古い呼び出しの置き換え');
		ctx.expect(
			progress.includes('1/3') && progress.includes('残り 2'),
			`置き換えたのに残りが減っていない（3 箇所のうち 1 箇所を消した）:\n${progress.slice(0, 300)}`
		);
		await ctx.shot('refactor-progress');

		// --- 当たらないパターンでは始まらない ---
		await dismiss(page);
		await runCommand(page, labels('command.trackRefactor')[0]);
		await typeAndEnter(page, 'zzz_not_here_zzz', { delay: 1200 });

		const none = await waitForNotification(page, '当たる箇所がありません');
		ctx.expect(
			none.includes('当たる箇所がありません'),
			`当たらないパターンなのに追跡が始まっている:\n${none.slice(0, 300)}`
		);
	}
};
