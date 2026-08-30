/**
 * 敵対的試験（T-345 / adv-01）— 壊れた台帳が何本混ざっても、まともな記録は一覧に出る。
 *
 * ## 何を疑っているか
 *
 * 台帳は**プロセスの外**にある。別ウィンドウ・別バージョン・手編集が書きうる前提で
 * 1 セッション 1 ファイルにしたのに、読み出しの関門は `parsed?.sessionId && parsed.owner` の
 * **2 つだけで、型を見ていない**（`extensions/nimbus/src/sessionStore.ts:88-91`）。
 * `sessionId` が数値・`totalCostUsd` が文字列・`cwd` がオブジェクトの記録が素通りし、
 * 一覧を組む側で TypeError になる。
 *
 * ## なぜ落ちうるか（一覧を組む側の当たりどころ）
 *
 * - `record.totalCostUsd.toFixed(4)`（`extension.ts:2451`）… 文字列なら TypeError
 * - `record.sessionId.slice(0, 8)`（`extension.ts:2453`・`title` が無いときだけ通る）… 数値なら TypeError
 * - `detail: record.cwd`（`extension.ts:2455`）… オブジェクトが混じる
 * - `isOwnerAlive` は `record.owner.heartbeatAt` を引く（`core/sessionRegistry.ts:73-75`）…
 *   `owner: []` は関門（truthy）を素通りする
 *
 * ここで例外が出ると `showSessions` は**一覧そのものを開かない**。毒 1 本のために、
 * 無事な記録まで巻き添えで見えなくなる — 並列で走らせているときに一番損をする壊れかた。
 *
 * ## 期待する振る舞い
 *
 * 読めない記録は数に入れず読み飛ばす（`sessionStore.ts:71` のコメントが自分でそう宣言している）。
 * 毒が何本あっても一覧は開き、まともな記録は並ぶ。
 *
 * 参考にした既存ケース: `cases/40-session-registry.mjs:18-19`（台詞ではなく**別プロセスが書いた記録**を置く）。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, notificationText, quickPickText, runCommand } from '../helpers.mjs';

/**
 * 毒の `cwd`（文字列側）に使う、どこでもない場所。
 *
 * **`ctx.workspace` の外**にしておく。中にすると `resumeCandidates` の cwd 絞りを通ってしまい、
 * 「前回の続き」としてタブへ戻されて次のケースへ持ち越す（`extension.ts:4794-4797`）。
 * 文字列として台帳に書くだけで、この場所には一切触らない。
 */
const ELSEWHERE = '/nimbus-adv-01-elsewhere';

export default {
	name: '壊れた台帳が何本混ざっても、まともな記録は一覧に出る',
	adversarial: true,
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'sessions');
		mkdirSync(dir, { recursive: true });

		/** 自分が置いたファイルだけを覚えておく（このウィンドウ自身の記録は消さない） */
		const written = [];
		const put = (name, body) => {
			const file = join(dir, name);
			writeFileSync(file, body);
			written.push(file);
		};

		const now = Date.now();
		// 心拍は 10 分前 = 持ち主なし。生きている持ち主を騙らない（横取りの経路に入れない）
		const dead = (windowId) => ({ windowId, pid: 1, heartbeatAt: now - 600000 });

		try {
			// まともな 1 本。`claudeSessionId` は**付けない** — 付けると「続きから」の候補になり、
			// タブへ戻って次のケースへ残る。一覧に出るかどうかには関係しない
			put(
				'adv-01-good.json',
				JSON.stringify({
					sessionId: 'adv-01-good-0001',
					status: 'awaiting-input',
					cwd: ctx.workspace,
					title: '無事な記録',
					createdAt: now - 600000,
					updatedAt: now - 600000,
					owner: dead('adv-01-good')
				})
			);

			// 毒 ①: sessionId が数値。`title` を**わざと付けない**ので
			// `record.sessionId.slice(0, 8)`（extension.ts:2453）が通る
			put(
				'adv-01-number-id.json',
				JSON.stringify({
					sessionId: 20260830,
					status: 'awaiting-input',
					cwd: ELSEWHERE,
					createdAt: now - 900000,
					updatedAt: now - 900000,
					owner: dead('adv-01-a')
				})
			);

			// 毒 ②: totalCostUsd が文字列（extension.ts:2451 の `.toFixed(4)`）
			put(
				'adv-01-cost-string.json',
				JSON.stringify({
					sessionId: 'adv-01-cost',
					status: 'awaiting-input',
					cwd: ELSEWHERE,
					title: '毒: 費用が文字列',
					createdAt: now - 900000,
					updatedAt: now - 900000,
					totalCostUsd: '3.5',
					owner: dead('adv-01-b')
				})
			);

			// 毒 ③: cwd がオブジェクト（extension.ts:2455 の `detail`）
			put(
				'adv-01-cwd-object.json',
				JSON.stringify({
					sessionId: 'adv-01-cwd',
					status: 'awaiting-input',
					cwd: { path: ELSEWHERE },
					title: '毒: cwd がオブジェクト',
					createdAt: now - 900000,
					updatedAt: now - 900000,
					owner: dead('adv-01-c')
				})
			);

			// 毒 ④: owner が配列。関門は truthy しか見ないので素通りする（sessionStore.ts:89）
			put(
				'adv-01-owner-array.json',
				JSON.stringify({
					sessionId: 'adv-01-owner',
					status: 'awaiting-input',
					cwd: ELSEWHERE,
					title: '毒: 持ち主が配列',
					createdAt: now - 900000,
					updatedAt: now - 900000,
					owner: []
				})
			);

			// 毒 ⑤: 書きかけで切れた JSON（別プロセスが書いている最中に読んだ形）
			put('adv-01-truncated.json', '{"sessionId":"adv-01-cut","owner":{"windowId":"adv-01-e",');

			// 毒 ⑥: 0 バイト（作っただけで中身が無い）
			put('adv-01-empty.json', '');

			await runCommand(page, labels('command.showSessions')[0]);

			// タイトルが描けるまで待つ。**コマンドパレットにはタイトルが無い**ので、
			// これが出た時点で「showSessions のピッカーが開いた」と言える。
			// 開かないまま最大 6 秒（毒で死んでいるときは、ここを使い切ってから赤にする）
			let title = '';
			for (let i = 0; i < 12 && !title; i++) {
				await page.waitForTimeout(500);
				title = await page.evaluate(() => {
					const widget = document.querySelector('.quick-input-widget');
					if (!widget || widget.style.display === 'none') {
						return '';
					}
					return (widget.querySelector('.quick-input-title')?.innerText ?? '').trim();
				});
			}

			const picker = await quickPickText(page);
			const rows = await page.evaluate(() =>
				[...document.querySelectorAll('.quick-input-widget .monaco-list-row')]
					.map((el) => el.innerText ?? '')
					.join('\n')
			);
			const rowCount = await page.evaluate(
				() => document.querySelectorAll('.quick-input-widget .monaco-list-row').length
			);
			// **例外で死ぬとピッカーは空文字になり、理由は通知にしか出ない。** 先に控える
			const notice = await notificationText(page);

			await ctx.shot('adv-01-ledger-garbage');
			// 選ばない（持ち主なしを選ぶと続きから開いて課金する）。閉じるだけ
			await page.keyboard.press('Escape');
			await page.waitForTimeout(400);

			// 行が 1 つも取れなかったときだけ、ピッカー全体の文字を代わりに見る。
			// 行の取りかたが変わったせいで「無事な記録が消えた」と誤って赤にしないため
			const listed = rows || picker;
			const where = `毒 6 本 + 無事な記録 1 本 / 行 ${rowCount} 件`;
			const evidence =
				`${where}\nタイトル:「${title}」\nピッカー:\n${picker.slice(0, 500)}\n通知:\n${notice.slice(0, 500)}`;

			ctx.expect(
				title.includes('走っているセッション'),
				`壊れた記録が混ざると、セッション一覧そのものが開かない（タイトルが描けていない）。${evidence}`
			);
			ctx.expect(
				listed.includes('無事な記録'),
				`壊れた記録に巻き込まれて、まともな記録まで一覧から消えた。${evidence}\n行:\n${rows.slice(0, 500)}`
			);
		} finally {
			// ここで ctx.expect を投げない（本来の失敗理由が消える）。失敗は console.log で言う
			await page.keyboard.press('Escape').catch(() => undefined);
			for (const file of written) {
				try {
					rmSync(file, { force: true });
				} catch (error) {
					console.log(`  ！ adv-01: 台帳の後始末に失敗しました: ${file}（${error.message}）`);
				}
			}
			// 横断の読み取りには 1 秒のキャッシュがある（sessionStore.ts:33 READ_CACHE_MS）。
			// 跨がせてから返さないと、消したはずの毒を次のケースが読む
			await page.waitForTimeout(1200);
		}
	}
};
