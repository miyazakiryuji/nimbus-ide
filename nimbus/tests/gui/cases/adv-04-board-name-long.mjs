/**
 * 敵対的試験 adv-04（T-345）: 切れ目の無い長いタスク名で、板が横に破れない。
 *
 * **何を疑っているか** — 同じ札の中で、ブランチ名には `word-break: break-all`
 * （`extensions/nimbus/media/board.css:73-78`）、直近の進捗には `nowrap + ellipsis`
 * （同 `:80-87`）が入っているのに、**名前（`.card .title`）だけ素通し**
 * （同 `:71` の `.card .title { font-weight: 600; }` に折り返しの指定が無い）。
 *
 * **なぜ落ちうるか** — 名前は入口でも一切畳まれない。板は `taskId` と `title` が在れば読む
 * （`extensions/nimbus/src/taskStore.ts:40-43`）だけで、描くのも `textContent` に素で入れる
 * （`extensions/nimbus/media/board.js:43`）。貼り付けた base64 や URL のような
 * **切れ目の無い 1 語**が来ると、既定の `word-break: normal` では折り返せず札が板の幅を突き抜ける。
 * `.board` は `overflow-y: auto`（同 `:41-48`）なので横も auto に落ち、
 * 横スクロールが生まれて「新しいタスク」が画面の外へ出る。
 *
 * **期待する振る舞い** — 板は縦にだけ送れる面のまま（`#board` の横のはみ出しが 4px 以内）で、
 * `#newTask` は生きている。要約も止まらず出る。
 *
 * 名前は 2,000 字にとどめる（10 万字にしない — 検出力は変わらず、描画待ちとスクショが重くなり、
 * 「製品の欠陥」と「レイアウトエンジンの病理」の区別も付かなくなる）。
 * `#newTask` は**押さない**（`InputBox` → worktree → 実セッションで課金する）。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openNimbusTasksSidebar, sidebarText } from '../helpers.mjs';

const TASK_ID = '00000000-0000-4000-8000-00000000ad04';
/** 切れ目の無い ASCII 2,000 字。折り返す手がかりが 1 つも無い名前 */
const NAME = 'B'.repeat(2000);

/** `#board` と `#newTask` を**両方**持つフレーム（コックピット／ゆあの面と取り違えない） */
async function boardFrame(page, { attempts = 14 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if ((await frame.$('#board')) && (await frame.$('#newTask'))) {
					return frame;
				}
			} catch {
				// フレームが入れ替わっている最中。次の周回で拾う
			}
		}
		await page.waitForTimeout(600);
	}
	return undefined;
}

/** 自分の札を**名前で**探して測る。先頭の札を読む書きかたにしない */
async function measure(frame, name) {
	return frame.evaluate((wanted) => {
		const board = document.getElementById('board');
		const newTask = document.getElementById('newTask');
		const cards = [...document.querySelectorAll('#board .card')];
		const mine = cards.find((card) => card.querySelector('.title')?.textContent === wanted);
		const box = newTask?.getBoundingClientRect();
		const shape = {
			found: Boolean(mine),
			cards: cards.length,
			titles: cards.map((card) => (card.querySelector('.title')?.textContent ?? '').slice(0, 24)),
			summary: document.getElementById('summary')?.textContent ?? '',
			viewport: Math.round(document.documentElement.clientWidth),
			boardOverflowX: board ? board.scrollWidth - board.clientWidth : -1,
			bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
			boardHeight: board ? Math.round(board.clientHeight) : -1,
			newTask: {
				alive: Boolean(newTask) && newTask.offsetParent !== null && box.width > 0 && box.height > 0,
				left: box ? Math.round(box.left) : -1,
				right: box ? Math.round(box.right) : -1
			}
		};
		if (!mine) {
			return shape;
		}
		const title = mine.querySelector('.title');
		const style = getComputedStyle(title);
		return {
			...shape,
			cardHeight: Math.round(mine.getBoundingClientRect().height),
			cardOverflowX: Math.round(mine.getBoundingClientRect().right - (board?.getBoundingClientRect().right ?? 0)),
			// 「どの指定が無いから破れたか」が出れば、直す側が迷わない
			style: {
				wordBreak: style.wordBreak,
				overflowWrap: style.overflowWrap,
				textOverflow: style.textOverflow,
				whiteSpace: style.whiteSpace
			}
		};
	}, name);
}

export default {
	name: '切れ目の無い長いタスク名で、板が横に破れない',
	adversarial: true,
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'tasks');
		const file = join(dir, `${TASK_ID}.json`);
		mkdirSync(dir, { recursive: true });
		const now = Date.now();
		writeFileSync(
			file,
			`${JSON.stringify({
				taskId: TASK_ID,
				title: NAME,
				repoCwd: ctx.workspace,
				worktreePath: join(ctx.workspace, 'nowhere-adv-04'),
				branch: 'nimbus/adv-04',
				prompt: '長い名前の札で板が破れないか',
				state: 'review',
				createdAt: now,
				updatedAt: now
			})}\n`
		);

		try {
			if (!(await openNimbusTasksSidebar(page))) {
				const head = (await sidebarText(page)).split('\n')[0];
				ctx.expect(false, `Nimbus タスクのサイドバーを開けない（板が出せない）: いまの見出し「${head}」`);
			}
			const frame = await boardFrame(page);
			ctx.expect(
				frame !== undefined,
				'`#board` と `#newTask` を両方持つフレームが無い（板が描かれていない）: ' +
					`フレーム ${page.frames().length} 枚`
			);

			// 別プロセスが書いた札を拾うのは 5 秒ごと（extension.ts:4785）。出るまで待つ。
			// 描き直しの最中はフレームが壊れて `evaluate` が投げるので、その回は「まだ出ていない」として扱い、
			// **最後に読めた実測値**を残す（失敗したときのメッセージが空にならないように）
			let seen;
			for (let i = 0; i < 16; i++) {
				const probed = await measure(frame, NAME).catch(() => undefined);
				if (probed) {
					seen = probed;
					if (seen.found) {
						break;
					}
				}
				await page.waitForTimeout(800);
			}
			ctx.expect(
				seen?.found,
				`2,000 字の名前の札が板に出てこない: 札 ${seen?.cards} 枚 / 見えている名前=${JSON.stringify(seen?.titles)} / 要約「${seen?.summary}」`
			);
			await ctx.shot('adv-04-board-name-long');

			const where =
				`名前=B×${NAME.length} / 板のはみ出し=${seen.boardOverflowX}px / body のはみ出し=${seen.bodyOverflowX}px / ` +
				`札の右端 − 板の右端=${seen.cardOverflowX}px / 札 ${seen.cardHeight}px・板 ${seen.boardHeight}px / ` +
				`title の指定=${JSON.stringify(seen.style)}`;

			// ① 板は縦にだけ送れる面のまま（横スクロールを生まない）
			ctx.expect(seen.boardOverflowX <= 4, `切れ目の無い長い名前で板が横に破れている: ${where}`);

			// ② 「新しいタスク」が生きている（見えていて、画面の外へ押し出されていない）
			ctx.expect(
				seen.newTask.alive && seen.newTask.left >= -1 && seen.newTask.right <= seen.viewport + 4,
				`「新しいタスク」が押せる場所に無い: 見えている=${seen.newTask.alive} / ` +
					`左 ${seen.newTask.left}px・右 ${seen.newTask.right}px（面の幅 ${seen.viewport}px） / ${where}`
			);

			// ③ 要約も止まらず出る。**枚数は決め打ちしない**（束の並び次第で崩れる）ので、
			//    「全 N」の形で 1 件以上を数えていることだけを部分一致で見る
			const counted = /全\s*(\d+)/.exec(seen.summary);
			ctx.expect(
				counted !== null && Number(counted[1]) >= 1,
				`長い名前の札で要約が止まっている: 要約「${seen.summary}」 / ${where}`
			);
		} finally {
			// 置いた記録は必ず片付ける。確認は「板が 0 枚に戻った」ではなく**自分の札が消えた**
			try {
				rmSync(file, { force: true });
			} catch (error) {
				console.log(`  ！ adv-04: 置いた記録を消せませんでした: ${error?.message ?? error}`);
			}
			const frame = await boardFrame(page, { attempts: 3 });
			let gone = false;
			for (let i = 0; i < 12 && frame; i++) {
				await page.waitForTimeout(800);
				const after = await measure(frame, NAME).catch(() => undefined);
				if (after && !after.found) {
					gone = true;
					break;
				}
			}
			if (!frame) {
				console.log('  ！ adv-04: 板のフレームが見つからず、札が消えたことを確かめられませんでした');
			} else if (!gone) {
				console.log('  ！ adv-04: 置いた 2,000 字の札が板から消えていません（次のケースに残ります）');
			}
			// 焦点をワークベンチへ戻す（`.part.activitybar` の中心はアイコンに当たるので使わない）
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(200);
		}
	}
};
