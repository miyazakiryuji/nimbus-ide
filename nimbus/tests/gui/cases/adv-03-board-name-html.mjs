/**
 * 敵対的試験 adv-03（T-345）— タスク名に HTML のかけらを入れても、札の上で要素にならない。
 *
 * **疑っていること**: 板へ入る道に検査が 1 つも無い。ディスクの記録は
 * `parsed?.taskId && parsed.title` の 2 つを見るだけで通り（`extensions/nimbus/src/taskStore.ts:40-43`）、
 * 突き合わせ（`extensions/nimbus/src/core/taskSync.ts:47-77`）も中身を見ない。5 秒ごとの同期
 * （`extensions/nimbus/src/extension.ts:4785`）でそのまま画面へ流れる。
 * つまり**壁は出口の `textContent` 1 枚だけ**（`extensions/nimbus/media/board.js:43, 48`）で、
 * 誰かが `innerHTML` へ書き換えた瞬間に破れる。CSP（`extensions/nimbus/src/webview/page.ts:29`）は
 * nonce 付きの同梱スクリプトしか許さないので `<script>` は走らないが、
 * `<img onerror>` / `<svg onload>` は CSP の外側で動く。
 *
 * **落ちうる形**: 別ウィンドウ・別バージョン・手編集が書いた 1 行が、
 * 板を見ただけで走る。名前の欄は「読み手が信用してよい」と暗黙に決めやすい場所なので、
 * 決めていないことを毎回叩く。
 *
 * 期待する振る舞い: 名前もブランチ名も**文字のまま**出る。板の中に
 * `img` / `script` / `b` / `svg` / `iframe` / `object` / `[onerror]` / `[onload]` が
 * 1 つも生えず、`document.body.dataset.pwned` も付かない。
 *
 * `#newTask` は**押さない**（`InputBox` → worktree → 実セッションで課金する）。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openNimbusTasksSidebar, sidebarText } from '../helpers.mjs';

const TASK_ID = 'adv-03-board-name-html';

/**
 * **必ずシングルクォートの連結で書く。** テンプレートリテラルにすると `${7*7}` が
 * 49 に展開され、確かめたい「文字のまま出るか」がテスト側で消える。
 */
const NAME =
	'<img src=x onerror="document.body.dataset.pwned=\'img\'">' +
	'</script><script>document.body.dataset.pwned=\'script\';</script>' +
	'${7*7}' +
	'&lt;b&gt;' +
	'"><b>ふとじ</b>';

/** ブランチ名も同じ入口（無検査）を通る。札の中で別の要素として描かれている */
const BRANCH = 'nimbus/<svg onload="document.body.dataset.pwned=\'svg\'"></svg>&amp;';

/** 板の中に生えてはいけないもの */
const GROWN =
	'#board img, #board script, #board b, #board svg, #board iframe, #board object, #board [onerror], #board [onload]';

/**
 * 板のフレーム。`#board` と `#newTask` を**両方**持つものだけを板とみなす
 * （コックピットやゆあの面と取り違えない）。
 *
 * 自分の札が出るまで待つが、出なくても板そのものは返す —
 * 「板が無い」と「板は在るが札が無い」は原因がまるで違うので、呼ぶ側で言い分ける。
 */
async function boardFrame(page, title, { attempts = 14 } = {}) {
	let seen;
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (!(await frame.$('#board')) || !(await frame.$('#newTask'))) {
					continue;
				}
				seen = frame;
				const mine = await frame.evaluate(
					(wanted) =>
						[...document.querySelectorAll('#board .card')].some(
							(card) => card.querySelector('.title')?.textContent === wanted
						),
					title
				);
				if (mine) {
					return { frame, mine: true };
				}
			} catch {
				// フレームが入れ替わっている最中。次で拾う
			}
		}
		// 最後の周回のあとは待たない（後始末に回す時間を削らない）
		if (i < attempts - 1) {
			await page.waitForTimeout(1000);
		}
	}
	return seen ? { frame: seen, mine: false } : undefined;
}

/** 自分の札まわりの実測値。失敗したときに「何がどう出ていたか」を言えるようにまとめて取る */
async function probe(frame, title) {
	return frame.evaluate(
		([wanted, selector]) => {
			const cards = [...document.querySelectorAll('#board .card')];
			const mine = cards.find((card) => card.querySelector('.title')?.textContent === wanted);
			return {
				found: Boolean(mine),
				cards: cards.length,
				titles: cards.map((card) => (card.querySelector('.title')?.textContent ?? '').slice(0, 80)),
				grown: [...document.querySelectorAll(selector)].map((el) => el.tagName.toLowerCase()),
				pwned: document.body.dataset.pwned ?? '',
				branch: mine?.querySelector('.branch')?.textContent ?? '(札が無い)'
			};
		},
		[title, GROWN]
	);
}

export default {
	name: 'タスク名の HTML のかけらが、板の札で要素にならない',
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
				worktreePath: join(ctx.workspace, 'nowhere-adv-03'),
				branch: BRANCH,
				prompt: '何もしない',
				// `pending` にしない — 待機列は空きが出ると**自動で開始**する（`TaskService.ts:275-282`）。
				// 敵対束は課金しないので、自動開始の芽が無い状態で置く
				state: 'review',
				createdAt: now,
				updatedAt: now
			})}\n`
		);

		// 後始末で掴み直さずに済むよう、見つけた板は try の外へ出しておく
		let view;
		try {
			if (!(await openNimbusTasksSidebar(page))) {
				const head = (await sidebarText(page)).split('\n')[0];
				ctx.expect(false, `Nimbus タスクのサイドバーを開けない（板が出せない）: いまの見出し「${head}」`);
			}

			// `#newTask` は**押さない**（InputBox → worktree → 実セッションへ行く）
			view = await boardFrame(page, NAME);
			ctx.expect(
				view !== undefined,
				`板のフレーム（#board と #newTask を両方持つもの）が見つからない: フレーム ${page.frames().length} 枚`
			);

			// 描き直しの最中は `evaluate` が投げる。その回は「まだ読めない」として扱い、数回だけ待つ
			let found;
			for (let i = 0; i < 3 && !found; i++) {
				found = await probe(view.frame, NAME).catch(() => undefined);
				if (!found) {
					await page.waitForTimeout(800);
				}
			}
			ctx.expect(
				found !== undefined,
				`板の中身を読めない（フレームが入れ替わり続けている）: フレーム ${page.frames().length} 枚`
			);

			ctx.expect(
				found.found,
				'置いた札が名前のまま出てこない（名前が加工されたか、同期が届いていない）: ' +
					`札 ${found.cards} 枚 / 名前 ${JSON.stringify(found.titles)}`
			);
			// 落ちる前に 1 枚残す。あとから「何がどう出ていたか」を目で確かめられるように
			await ctx.shot('adv-03-board-name-html');

			// 本丸。出口の `textContent` が破れていれば、ここに要素が生えている
			ctx.expect(
				found.grown.length === 0,
				`名前とブランチ名が要素になっている: ${found.grown.length} 個 <${found.grown.join('><')}> が板の中に生えた` +
					`（名前は文字のまま出さなければならない）`
			);
			ctx.expect(
				found.pwned === '',
				`板の中で仕込んだ処理が走った: document.body.dataset.pwned="${found.pwned}"`
			);

			// ブランチ名も同じ入口を通る。こちらは別の要素なので別に確かめる
			ctx.expect(
				found.branch === BRANCH,
				`ブランチ名が文字のまま出ていない: 期待 ${JSON.stringify(BRANCH)} / 実際 ${JSON.stringify(found.branch.slice(0, 120))}`
			);
		} finally {
			// 毒を残さない。消えたことの確認は「板が 0 枚」ではなく**自分の札が消えた**で見る
			try {
				rmSync(file, { force: true });
			} catch (error) {
				console.log(`  ！ adv-03: 置いた記録を消せませんでした: ${error?.message ?? error}`);
			}
			// 同期は 5 秒ごと。読めなくなったときだけ、板を 1 度掴み直す
			let frame = view?.frame;
			let gone = false;
			for (let i = 0; i < 12 && !gone; i++) {
				await page.waitForTimeout(800);
				const after = frame ? await probe(frame, NAME).catch(() => undefined) : undefined;
				if (after) {
					gone = !after.found;
					continue;
				}
				frame = (await boardFrame(page, NAME, { attempts: 2 }).catch(() => undefined))?.frame;
				if (!frame) {
					break;
				}
			}
			if (!frame) {
				console.log('  ！ adv-03: 板のフレームが見つからず、札が消えたことを確かめられませんでした');
			} else if (!gone) {
				console.log('  ！ adv-03: 置いた札が板から消えていません（次のケースへ持ち越します）');
			}
			// 焦点をワークベンチへ戻す（`.part.activitybar` の中心はアイコンに当たるので使わない）
			await page.click('.part.statusbar', { position: { x: 400, y: 10 } }).catch(() => undefined);
			await page.waitForTimeout(200);
		}
	}
};
