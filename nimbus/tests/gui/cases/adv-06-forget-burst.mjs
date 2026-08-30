/**
 * 敵対的試験（T-345）: 「一覧から消す」は、板からもディスクからも本当に消える。
 *
 * **疑っているのは「連打で race」ではなく「消したものが戻ってこないか」。**
 * `forget` はメモリと `knownIds` から**同期で**消すのに、ディスクの削除だけが
 * `void this.store?.remove(taskId)` の投げっぱなし（`src/tasks/TaskService.ts:268-273`）。
 * 5 秒ごとの突き合わせ（`src/extension.ts:4785`）は「手元に無い・ディスクに在る・`knownIds` にも無い」
 * を**新顔として拾い直す**ので（`src/core/taskSync.ts:52-77` の後段ループ）、
 * 削除が届かない・別のディレクトリを見ている・`rm` の失敗が握り潰された（`src/taskStore.ts:70-78` は
 * 失敗をログに落とすだけ）とき、消したカードが 5 秒後にそのまま戻ってくる。
 *
 * 窓そのものは数ミリ秒しかないので、ここでは**突き合わせを 1 回またいでから**見る。
 * 判定は**ディスクを正、板の文字列を従**（描画の遅れで揺れるのは板の側）。
 *
 * 置くのは `state: 'done'` のタスク 3 件。done のカードには「一覧から消す」しか出ないので
 * （`media/board.js:62-70`）、worktree にもセッション開始にも触れずに済む＝課金しない。
 *
 * 根拠: `extensions/nimbus/src/tasks/TaskService.ts:73-104, 268-273` /
 * `extensions/nimbus/src/taskStore.ts:70-78` / `extensions/nimbus/src/core/taskSync.ts:52-77` /
 * `extensions/nimbus/media/board.js:38, 62-70` / `extensions/nimbus/src/extension.ts:4785`
 */
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, runCommand, webviewText } from '../helpers.mjs';

/** 自分が置いたものだけを名前で見分ける印（束の残骸を巻き込まないため） */
const MARKER = 'adv-06 消えるはずのタスク';
const TASK_IDS = [
	'00000000-0000-4000-8000-000000000601',
	'00000000-0000-4000-8000-000000000602',
	'00000000-0000-4000-8000-000000000603'
];

/**
 * 板を描いているフレームのうち、**自分のタスクが見えているもの**を返す。見つからなければ `undefined`。
 *
 * 板はサイドバーとタブの 2 枚が同時に生きうるので `#board` だけでは足りない。
 * `run` 本体に `for (…) { return frame; }` を書くと、見つからなかったときに
 * `ctx.expect` を 1 度も通らず緑で抜けるので、ここへ切り出してある。
 */
async function boardFrame(page, marker) {
	for (const frame of page.frames()) {
		try {
			const hit = await frame.evaluate(
				(needle) =>
					Boolean(document.getElementById('board')) && (document.body?.innerText ?? '').includes(needle),
				marker
			);
			if (hit) {
				return frame;
			}
		} catch {
			// 破棄されたフレームは飛ばす
		}
	}
	return undefined;
}

/** 板を描いているフレーム全部の本文（消えたことの確認に使う。フレームを選べない状態でも読める） */
async function boardTexts(page) {
	const found = [];
	for (const frame of page.frames()) {
		try {
			const text = await frame.evaluate(() =>
				document.getElementById('board') ? (document.body?.innerText ?? '') : ''
			);
			if (text) {
				found.push(text);
			}
		} catch {
			// 破棄されたフレームは飛ばす
		}
	}
	return found.join('\n');
}

export default {
	name: '「一覧から消す」は板からもディスクからも本当に消える（敵対）',
	adversarial: true,
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'tasks');
		const paths = TASK_IDS.flatMap((id) => [join(dir, `${id}.json`), join(dir, `${id}.progress.jsonl`)]);
		/** 自分が置いたファイルだけを消す。戻り値は消せた本数（後始末の判断に使う） */
		const sweep = () => {
			let removed = 0;
			for (const path of paths) {
				try {
					if (existsSync(path)) {
						rmSync(path, { force: true });
						removed++;
					}
				} catch (error) {
					console.log(`  ！ 置いた記録を消せませんでした: ${path}（${error?.message ?? error}）`);
				}
			}
			return removed;
		};

		try {
			mkdirSync(dir, { recursive: true });
			const at = Date.now() - 60 * 1000;
			TASK_IDS.forEach((id, index) => {
				writeFileSync(
					join(dir, `${id}.json`),
					`${JSON.stringify({
						taskId: id,
						title: `${MARKER} ${index + 1}`,
						repoCwd: ctx.workspace,
						worktreePath: join(ctx.workspace, `nowhere-adv-06-${index + 1}`),
						branch: `nimbus/adv-06-${index + 1}`,
						prompt: '押さない（done なので開始のボタンは出ない）',
						state: 'done',
						createdAt: at + index,
						updatedAt: at + index
					})}\n`,
					'utf8'
				);
				appendFileSync(
					join(dir, `${id}.progress.jsonl`),
					`${JSON.stringify({ at, kind: 'done', text: `完了（GUI テストが置いた ${index + 1}）` })}\n`,
					'utf8'
				);
			});

			// 板はタブで開く（アクティビティバーの開閉に依らない）。突き合わせは 5 秒ごとなので待つ
			await runCommand(page, labels('command.openBoardTab')[0]);
			const shown = await webviewText(page, [`${MARKER} 1`], { attempts: 16 });
			ctx.expect(
				shown !== undefined,
				`置いた done のタスクが板に出てこない（この経路では消える前まで再現できない）。板の本文:\n${(
					await boardTexts(page)
				).slice(0, 400)}`
			);

			const frame = await boardFrame(page, `${MARKER} 1`);
			ctx.expect(
				frame !== undefined,
				`板を描いているフレームを掴めない（#board を持つフレームの本文に「${MARKER}」が無い）。板の本文:\n${(
					await boardTexts(page)
				).slice(0, 400)}`
			);

			// 1 tick のうちに、自分の札の「一覧から消す」だけを押す。
			// **他のボタン（開始 / worktree を開く / 完了）は押さない** — 課金と worktree 操作に繋がる
			const pressed = await frame.evaluate((needle) => {
				let clicked = 0;
				const seen = [];
				for (const card of document.querySelectorAll('#board .card')) {
					const title = card.querySelector('.title')?.textContent ?? '';
					if (!title.startsWith(needle)) {
						continue;
					}
					for (const button of card.querySelectorAll('.actions button')) {
						const label = button.textContent ?? '';
						seen.push(label);
						if (label.includes('一覧から消す')) {
							button.click();
							clicked++;
						}
					}
				}
				return { clicked, seen };
			}, MARKER);
			ctx.expect(
				pressed.clicked >= TASK_IDS.length,
				`自分の done の札で「一覧から消す」を押せたのが ${pressed.clicked} 個しかない（置いたのは ${TASK_IDS.length} 件）。札に出ていたボタン: ${
					pressed.seen.join(' / ') || '（なし）'
				}`
			);

			// 突き合わせ（5 秒周期）を 1 回またぐ。ここで戻ってくるなら削除が届いていない
			await page.waitForTimeout(7000);
			await ctx.shot('adv-06-forget-burst');

			// 判定はディスクが正
			const left = paths.filter((path) => existsSync(path));
			ctx.expect(
				left.length === 0,
				`「一覧から消す」を押したのに記録がディスクに残っている（${left.length}/${paths.length} 本）: ${left
					.map((path) => path.slice(dir.length + 1))
					.join(', ')}`
			);

			// 板の文字列は従。描画の遅れで揺れるので、**突き合わせの 1 周期（5 秒）ぶん**待ってから見る。
			// 3 秒だと周期をまたげず、「削除がディスクへ届く前に拾い直された 1 枚」が消えきる前に読んで
			// 偽の赤になる。消えていれば 1 度も待たない（この輪は失敗しかけのときだけ回る）
			let after = await boardTexts(page);
			for (let i = 0; i < 6 && after.includes(MARKER); i++) {
				await page.waitForTimeout(1000);
				after = await boardTexts(page);
			}
			ctx.expect(
				!after.includes(MARKER),
				`消したはずのタスクが板に戻っている（ディスクからは消えているのに「${MARKER}」が残る）。板の本文:\n${after.slice(
					0,
					400
				)}`
			);
		} finally {
			// 置いた記録を片付ける。消えていなければ、突き合わせが書き戻す隙を跨いでもう一度掃く。
			// **ここで例外を投げると本来の失敗理由が消える**ので、待ちごと包んで console.log に落とす
			try {
				if (sweep() > 0) {
					await page.waitForTimeout(6000);
					sweep();
				}
			} catch (error) {
				console.log(`  ！ 置いた記録の後始末に失敗: ${error?.message ?? error}`);
			}
			// 開いた板のタブだけを閉じる（✕ を実マウスで押す。和音は待ち状態が残る）。
			// 閉じられなくても落とさない — run.mjs の resetWorkbench が後段で拾う。
			// 押せないときは既定の 30 秒待ちに入って 1 ケース 60 秒を食い潰すので、短い待ちで諦める
			try {
				for (let i = 0; i < 4; i++) {
					let closed = false;
					for (const tab of await page.$$('.tabs-container .tab')) {
						const text = await tab.evaluate((el) => el.innerText ?? '').catch(() => '');
						if (!/タスク|Task/i.test(text)) {
							continue;
						}
						const closer = await tab.$('.codicon-close');
						if (!closer) {
							continue;
						}
						closed = await closer.click({ timeout: 3000 }).then(
							() => true,
							(error) => {
								console.log(`  ！ 板のタブの ✕ を押せませんでした: ${error?.message ?? error}`);
								return false;
							}
						);
						await page.waitForTimeout(500);
						break;
					}
					if (!closed) {
						break;
					}
				}
			} catch (error) {
				console.log(`  ！ 板のタブを閉じられませんでした: ${error?.message ?? error}`);
			}
			// 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）。
			// `.part.activitybar` の中心はアイコンに当たるので、ステータスバーを位置指定で押す
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(300);
		}
	}
};
