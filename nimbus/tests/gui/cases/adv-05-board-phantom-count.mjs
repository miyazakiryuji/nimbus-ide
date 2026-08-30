/**
 * 敵対的試験（T-345）— 板の「全 N」と、見えているカードの枚数が一致する。
 *
 * **疑っている壊れかた**: タスクの読み出しの関門は `parsed?.taskId && parsed.title` の 2 つだけで、
 * `state` は一切見ていない（`extensions/nimbus/src/taskStore.ts:40-43`）。板は 5 つの列
 * （`extensions/nimbus/src/core/tasks.ts:91-97` の `KANBAN_COLUMNS`）ごとに
 * `tasks.filter((t) => t.state === column.state)` で絞ってカードを作るので
 * （`extensions/nimbus/media/board.js:92-101`）、**知らない状態のタスクはどの列にも入らず姿を消す**。
 * ところが要約だけは `message.tasks.length` を数える（`extensions/nimbus/media/board.js:81-83`）。
 * 拡張ホスト側は読めたものをそのまま渡すだけ（`extensions/nimbus/src/tasks/BoardViewProvider.ts:78-79`）で、
 * 記録は 5 秒ごとにディスクから拾い直す（`extensions/nimbus/src/extension.ts:4785`）から、
 * 別ウィンドウ・別バージョン・手編集が置いた 1 本で「全 3 なのにカードは 1 枚」が成立する。
 *
 * **なぜ落ちうるか**: 探しても見つからない仕事が数字にだけ残る。並列で走らせているとき、
 * 「もう 2 本あるはずだ」と数字を信じて探し続ける時間が丸ごと損になる。
 *
 * 期待するのは「数えたものは必ず見える場所に出る」ことだけで、**どの列へ倒すかは決めない**
 * （直しかたは実装者が決める）。カードのボタン（開始 / worktree を開く / 完了 / 一覧から消す）は
 * 押さない — worktree と実セッションに触れるため。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { labels, runCommand, webviewText } from '../helpers.mjs';

/** 自分が置いた札。板は他のケースの残りも載せるので、**名前で**探す */
const GOOD = 'まともなタスク';

const IDS = {
	good: '00000000-0000-4000-8000-000000000051',
	unknown: '00000000-0000-4000-8000-000000000052',
	empty: '00000000-0000-4000-8000-000000000053'
};

/** 後始末のログに出す一行（`ctx.expect` は投げない） */
function message(error) {
	return error instanceof Error ? error.message : String(error);
}

/** 記録の形は `core/tasks.ts` の `KanbanTask`。`state` だけを外して置く */
function record(taskId, title, state, workspace) {
	const now = Date.now();
	return JSON.stringify({
		taskId,
		title,
		repoCwd: workspace,
		worktreePath: join(workspace, 'nowhere'),
		branch: 'nimbus/adv-05',
		prompt: '直して',
		state,
		createdAt: now,
		updatedAt: now
	});
}

/**
 * 板のフレームを 1 回だけ探す。
 *
 * `#board` を持ち、かつ本文に自分の札を含むものだけを選ぶ —— 板はサイドバーとタブの
 * **2 枚が同時に生きうる**ので、`#board` だけで掴むと空のほうを読む。
 * `run` の中に `for (…) { return frame; }` を書くと、見つからなかったときに `ctx.expect` を
 * 1 度も通らず**緑で抜ける**ので、探索はここに切り出してある。
 */
async function boardFrameNow(page) {
	for (const frame of page.frames()) {
		try {
			if (!(await frame.$('#board'))) {
				continue;
			}
			const text = await frame.evaluate(() => document.body?.innerText ?? '');
			if (text.includes(GOOD)) {
				return frame;
			}
		} catch {
			// フレームが入れ替わっている最中。次の周で拾う
		}
	}
	return undefined;
}

/** 見つかるまで待つ。見つからなければ `undefined`（判定は呼び出し側の `ctx.expect`） */
async function waitForBoardFrame(page, { attempts = 12 } = {}) {
	for (let i = 0; i < attempts; i++) {
		const frame = await boardFrameNow(page);
		if (frame) {
			return frame;
		}
		await page.waitForTimeout(500);
	}
	return undefined;
}

export default {
	name: '板の「全 N」と、見えているカードの枚数が一致する',
	adversarial: true,
	async run(page, ctx) {
		const dir = join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'tasks');
		const files = Object.values(IDS).map((id) => join(dir, `${id}.json`));
		try {
			mkdirSync(dir, { recursive: true });
			writeFileSync(files[0], record(IDS.good, GOOD, 'pending', ctx.workspace));
			writeFileSync(files[1], record(IDS.unknown, '知らない状態のタスク', 'banana', ctx.workspace));
			writeFileSync(files[2], record(IDS.empty, '状態が空のタスク', null, ctx.workspace));

			// 板はタブで開く（前のケースがどの段を開いていても同じように出る）。
			// 突き合わせは 5 秒ごとなので、置いてから拾われるまで待つ
			await runCommand(page, labels('command.openBoardTab')[0]);
			const listed = await webviewText(page, [GOOD], { attempts: 16 });
			const frame = await waitForBoardFrame(page, { attempts: 8 });
			ctx.expect(
				frame !== undefined,
				`板（#board）の中に「${GOOD}」を載せたフレームが無い（読めた本文: ${
					listed === undefined ? '見つからず' : listed.slice(0, 200).replace(/\n/g, ' / ')
				}）`
			);

			// 数字とカードは**同じフレームから**読む（2 枚目の板と混ぜない）
			const summary = await frame.$eval('#summary', (el) => el.textContent ?? '').catch(() => '');
			const titles = await frame
				.$$eval('#board .card .title', (els) => els.map((el) => el.textContent ?? ''))
				.catch(() => []);
			const columns = await frame
				.$$eval('#board .column-title', (els) => els.map((el) => el.textContent ?? ''))
				.catch(() => []);
			// 数えるのは `.card` そのもの（見出しの有無に依らない）。名前は失敗のときの手掛かり
			const cards = await frame.$$eval('#board .card', (els) => els.length).catch(() => titles.length);
			const seen = `要約「${summary}」/ カード ${cards} 枚: ${titles.join(' , ') || '（なし）'} / 列: ${
				columns.join(' , ') || '（なし）'
			}`;

			const matched = /全\s*(\d+)/.exec(summary);
			ctx.expect(
				matched !== null,
				`板の要約（#summary）から「全 N」が読めない（${seen}）。数えた結果を出す場所が無ければ、食い違いに誰も気づけない`
			);
			const total = Number(matched[1]);

			// **枚数ではなく名前で探す。** 束の並び次第で他のケースの札が残りうるので、
			// 「1 枚以上ある」では自分の札が消えていても素通りする
			ctx.expect(
				titles.some((title) => title.includes(GOOD)),
				`置いた「${GOOD}」（state: pending）のカードが板に描かれていない（${seen}）`
			);
			ctx.expect(
				total === cards,
				`数えた数と見えている数が食い違う: 要約は「全 ${total}」なのに、描かれたカードは ${cards} 枚（${seen}）。` +
					' 置いた 3 件のうち、知らない状態（banana）と空（null）の 2 件がどの列にも入らず、数にだけ残っている'
			);
		} finally {
			// 後始末は**段ごとに包む**。1 つ目でこけたときに残りが飛ぶと、
			// いちばん効く焦点戻しまで一緒に落ちて次のケースを巻き込む（helpers の実測メモと同じ穴）。
			// どの段も `ctx.expect` は投げない — 本来の失敗理由を消さないため
			for (const file of files) {
				try {
					rmSync(file, { force: true });
				} catch (error) {
					console.log(`  ！ 後始末: 置いた記録を消せませんでした（${file}）: ${message(error)}`);
				}
			}

			// 5 秒周期に固定待ちを合わせると、周期がずれた瞬間に毒を次のケースへ持ち越す。
			// **消えるまで**見る（最大 10 秒）
			try {
				let left = true;
				for (let i = 0; i < 20; i++) {
					left = (await boardFrameNow(page)) !== undefined;
					if (!left) {
						break;
					}
					await page.waitForTimeout(500);
				}
				if (left) {
					console.log(`  ！ 後始末: 10 秒待っても板から「${GOOD}」が消えませんでした`);
				}
			} catch (error) {
				console.log(`  ！ 後始末: 板から消えたことを確かめられませんでした: ${message(error)}`);
			}

			// タブは ✕ を実際に押して閉じる（キーボードの和音は待ち状態が残る）。
			// 押すのは板のタブ（`Nimbus タスク`）だけ — 走行中セッションのタブに触ると
			// `{ modal: true }` が出て束が丸ごと死ぬ
			try {
				for (let i = 0; i < 4; i++) {
					let closed = false;
					for (const tab of await page.$$('.tabs-container .tab')) {
						const text = await tab.evaluate((el) => el.innerText ?? '').catch(() => '');
						if (!/タスク|Task/i.test(text)) {
							continue;
						}
						const close = await tab.$('.codicon-close, .tab-close');
						if (!close) {
							continue;
						}
						await close.click().catch(() => undefined);
						closed = true;
						break;
					}
					if (!closed) {
						break;
					}
					await page.waitForTimeout(500);
				}
			} catch (error) {
				console.log(`  ！ 後始末: 板のタブを閉じられませんでした: ${message(error)}`);
			}

			// 焦点を webview の外へ戻す（次のケースがキーボードで操作できるように）。
			// `.part.activitybar` の中心はアイコンに当たるので、ステータスバーの何も無いところを押す
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(400).catch(() => undefined);
		}
	}
};
