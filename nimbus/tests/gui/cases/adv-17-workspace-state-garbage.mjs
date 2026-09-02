/**
 * 敵対的試験（T-379 / adv-17）— 保存した番号・名前・ピン・下書きの値が壊れていても、有効化が落ちない。
 *
 * ## 何を疑っているか
 *
 * 起動時の復元は `workspaceState` の値を**そのまま `new Map(...)` / `new Set(...)` に渡している**
 * （`extensions/nimbus/src/extension.ts:429-440`）。`Map` のコンストラクタは「対の配列」しか受けない
 * ので、保存値が文字列・数値・オブジェクトになっていると **TypeError で `activate()` ごと落ちる**。
 * 落ちると Nimbus のサイドバーもコックピットも一切出ない — 1 つの壊れた値で全機能が消える。
 * 下書き（`nimbus.drafts`）の読み出しだけは 1 件ずつ検めている（`:394-407`）ので、そこと不揃い。
 * `nimbus.sessionCounter` が文字列 `"9"` だと `sessionCounter += 1` が**文字列結合**になり、
 * 番号が `91`・`911` と化ける（落ちないぶん、たちが悪い）。
 *
 * workspaceState は Nimbus しか書かないが、版の違い・書きかけ・手編集で壊れうる。
 * 台帳（adv-01）で決めた原則「読めないものは読み飛ばし、無事なものは生かす」は、ここにも当てはまる。
 *
 * ## 期待する振る舞い
 *
 * 壊れた値は無かったことにして起動する。サイドバーとコックピットは開き、「+」は効き、
 * 番号は整数のまま振られる。有効化の失敗（`Activating extension ... failed`）を通知に出さない。
 *
 * ## 手順の要点
 *
 * 保存ファイル（`workspaceStorage/<hash>/state.vscdb`）は**アプリが開いている間は書き換えられない**
 * （終了時に覚えている値で上書きされる）。`ctx.restart({ beforeLaunch })` で、閉じてから開くまでの
 * 間に毒を置く。毒が届いたことは、行が見つかり `nimbus.sessionNumbers` が入っていたことで先に確かめる。
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { notificationText, openNimbusSidebar, runCommand } from '../helpers.mjs';

const EXTENSION_KEY = 'idris.nimbus';

/** `state.vscdb` の中から、拡張の workspaceState の行を探す */
function findStateRow(userDataDir) {
	const root = join(userDataDir, 'User', 'workspaceStorage');
	const found = [];
	for (const dir of readdirSync(root, { withFileTypes: true })) {
		if (!dir.isDirectory()) {
			continue;
		}
		const db = join(root, dir.name, 'state.vscdb');
		let rows;
		try {
			const out = execFileSync('sqlite3', ['-json', db, `SELECT key, value FROM ItemTable WHERE key LIKE '%nimbus%'`], {
				encoding: 'utf8'
			});
			rows = out.trim() ? JSON.parse(out) : [];
		} catch {
			continue;
		}
		for (const row of rows) {
			found.push({ db, key: row.key, value: row.value });
		}
	}
	return found;
}

function writeStateRow(db, key, value) {
	const escaped = value.replace(/'/g, "''");
	execFileSync('sqlite3', [db, `UPDATE ItemTable SET value = '${escaped}' WHERE key = '${key}'`]);
}

async function cockpit(page, { attempts = 24 } = {}) {
	for (let i = 0; i < attempts; i++) {
		for (const frame of page.frames()) {
			try {
				if (await frame.$('#sessionTabs')) {
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

const tabNumbers = (frame) =>
	frame.evaluate(() =>
		[...document.querySelectorAll('.session-tab')].map((tab) =>
			(tab.querySelector('.session-tab-number')?.textContent ?? '').trim()
		)
	);

export default {
	name: '保存した番号・名前・ピンの値が壊れていても、有効化は落ちない',
	adversarial: true,
	async run(page, ctx) {
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		// 下書きを 2 本立てて、workspaceState の行（nimbus.drafts）を書かせる
		for (let i = 0; i < 2; i++) {
			await runCommand(page, '新しいセッション');
		}
		await page.waitForTimeout(800);

		let poisoned;
		const reopened = await ctx.restart({
			beforeLaunch: async () => {
				const rows = findStateRow(ctx.userDataDir);
				const row = rows.find((r) => r.key === EXTENSION_KEY);
				poisoned = { rows: rows.map((r) => `${r.key}@${r.db}`), had: false };
				if (!row) {
					return;
				}
				let state;
				try {
					state = JSON.parse(row.value);
				} catch {
					return;
				}
				/*
				 * 関門は**下書き**で見る。「+」で書かれるのは `nimbus.drafts` だけで、番号の台帳
				 * （`nimbus.sessionNumbers`）は閉じる・名前を変える・ピンのときにしか書かれない
				 * （実測: 関門を番号にしたら `had: false` で止まった）。毒は無い鍵にも置く —
				 * 無い鍵に壊れた値が入っているのが、まさに疑っている形
				 */
				poisoned.had = Array.isArray(state['nimbus.drafts']);
				// 毒: 配列であるべきものを文字列・数値・オブジェクトに。カウンタは文字列に
				state['nimbus.sessionNumbers'] = 'abc';
				state['nimbus.sessionNames'] = 42;
				state['nimbus.pinnedSessions'] = { a: 1 };
				state['nimbus.drafts'] = 'x';
				state['nimbus.sessionCounter'] = '9';
				writeStateRow(row.db, EXTENSION_KEY, JSON.stringify(state));
			}
		});

		// 毒が届いていないなら、この先は何も確かめていない（偽の緑を先に潰す）
		ctx.expect(
			poisoned?.had === true,
			`毒を置けなかった（workspaceState の行が見つからないか、下書きが書かれていない）: ${JSON.stringify(poisoned)}`
		);

		const notice = await notificationText(reopened);
		const opened = await openNimbusSidebar(reopened);
		const frame = opened ? await cockpit(reopened) : undefined;
		ctx.expect(
			opened && frame !== undefined,
			`壊れた保存値で有効化が落ちた（サイドバー ${opened ? '開いた' : '開けない'} / コックピット ${frame ? '有' : '無'}）。通知:\n${notice.slice(0, 600)}`
		);
		ctx.expect(
			!/Activating extension|有効化に失敗|failed/i.test(notice),
			`有効化の失敗が通知に出ている:\n${notice.slice(0, 600)}`
		);

		// 「+」が効き、番号が整数のまま振られる（"9"+1 → "91" の文字列結合を掴む）
		await runCommand(reopened, '新しいセッション');
		await page.waitForTimeout(800);
		const numbers = await tabNumbers(frame);
		ctx.expect(
			numbers.length >= 1 && numbers.every((n) => /^\d{1,3}$/.test(n)) && new Set(numbers).size === numbers.length,
			`壊れたカウンタで番号が化けた（整数でない・重複・3 桁超）: ${JSON.stringify(numbers)}`
		);
		await ctx.shot('adv-17-workspace-state-garbage');
	}
};
