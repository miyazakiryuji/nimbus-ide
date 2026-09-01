/**
 * **動いているタブを × で閉じたら、台帳からも消える**（T-373・Codex の棚卸し A-3）。
 *
 * `sessions.discard()` は Map から外すだけで、台帳の削除も完了イベントも起こさない。
 * 同じ窓では `sessionsSeenHere` が復活を抑えるが、**その Set は窓ごと**なので、
 * 次に開いた窓では「閉じたはずのセッション」が「続きから」の候補に戻ってくる。
 *
 * T-371（再開が台帳を空で上書きする）を直すまでは、鍵が失われて候補から落ちていたので
 * **この穴は見えていなかった**。片方を直すともう片方が出る類。
 *
 * ⚠ **課金が要る**（`--with-claude` のときだけ走る）。本物のセッションが 1 本立っていないと
 * 「動いているタブを閉じる」経路を通れない。指定が無ければ何もしないので、
 * **既定の実行では緑に見えるだけで何も確かめていない**（偽の緑）。
 * 台帳を種にして通す形は、fake SDK の口ができてから（Codex 提案）。
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { openNimbusSidebar, runCommand } from '../helpers.mjs';

function ledgerDir(ctx) {
	return join(ctx.userDataDir, 'User', 'globalStorage', 'idris.nimbus', 'sessions');
}

function ledger(ctx) {
	try {
		return readdirSync(ledgerDir(ctx)).filter((name) => name.endsWith('.json')).sort();
	} catch {
		return [];
	}
}

/** 記録の状態。**走っている間は閉じられない**（確認のモーダルが出て止まる）ので、終わるまで待つ */
function statuses(ctx) {
	return ledger(ctx).map((name) => {
		try {
			return JSON.parse(readFileSync(join(ledgerDir(ctx), name), 'utf8')).status;
		} catch {
			return 'unknown';
		}
	});
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

export default {
	name: '動いているタブを閉じると、台帳からも消える（T-373・--with-claude）',
	async run(page, ctx) {
		if (!ctx.withClaude) {
			return; // 指定が無ければ何もしない（成功扱い）
		}
		ctx.expect(await openNimbusSidebar(page), 'Nimbus のサイドバーを開けない');
		const frame = await cockpit(page);
		ctx.expect(frame !== undefined, 'コックピットのタブ列（#sessionTabs）が見つからない');

		// 起動時のスモークが本物のセッションを 1 本起こしている
		let before = [];
		for (let i = 0; i < 20 && before.length === 0; i++) {
			await page.waitForTimeout(500);
			before = ledger(ctx);
		}
		ctx.expect(
			before.length > 0,
			'台帳に記録が 1 つも無い（この先の判定が何も確かめていない）'
		);

		/*
		 * **走り終わるまで待つ。** 動いている間に閉じると確認のモーダルが出て、
		 * ここで止まる（モーダルは以後の操作を全部塞ぐ）。
		 */
		for (let i = 0; i < 40; i++) {
			if (!statuses(ctx).some((status) => status === 'running' || status === 'starting')) {
				break;
			}
			await page.waitForTimeout(500);
		}

		/*
		 * **タブ列はセッションが 2 本以上のときだけ出る**（ケース 47）。
		 * 本物は 1 本しか無いので、下書きを 1 枚足して列を出す。
		 * 閉じるのは**本物のほう**（下書きを閉じても台帳は動かない ＝ 何も確かめられない）。
		 */
		await runCommand(page, '新しいセッション');
		await page.waitForTimeout(1500);
		const closed = await frame.evaluate(() => {
			const tabs = [...document.querySelectorAll('.session-tab')];
			// 下書きの id は `draft-` で始まる。本物はそれ以外
			const live = tabs.find((tab) => !(tab.getAttribute('data-session-id') ?? '').startsWith('draft-'));
			const close = live?.querySelector('.session-tab-close');
			if (!close) {
				return { ok: false, tabs: tabs.length, ids: tabs.map((t) => t.getAttribute('data-session-id')) };
			}
			/** @type {HTMLElement} */ (close).click();
			return { ok: true, tabs: tabs.length };
		});
		ctx.expect(closed.ok, `本物のセッションのタブ × が見つからない: ${JSON.stringify(closed)}`);
		await page.waitForTimeout(3000);

		const after = ledger(ctx);
		ctx.expect(
			after.length < before.length,
			`閉じたのに台帳へ記録が残っている（次の窓で「続きから」に戻ってくる）: ` +
				`前 ${JSON.stringify(before)} 後 ${JSON.stringify(after)}`
		);

		await ctx.shot('close-forgets-record');
	}
};
