/**
 * 計測結果の取り込みと、ターミナルの多分割。
 *
 * 仕様側の「画面確認（未実施）」を閉じる:
 * [cpu-profile](../../../docs/specs/cpu-profile.md) / [terminal-layout](../../../docs/specs/terminal-layout.md)。
 *
 * **実セッション（課金）は要らない。** 置いたファイルを読むのと、窓を並べるだけ。
 *
 * 見たいのは「開くか」ではなく**判断が効いているか**:
 *   - 計測結果 — ランタイムの中身を「直しに行ける場所」に混ぜていないか
 *   - ターミナル — 頼んだ枚数だけ、実際に並ぶか
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, labels, runCommand } from '../helpers.mjs';

/** `node --cpu-prof` が出す形（実物から起こした最小の 1 枚） */
function sampleProfile() {
	return JSON.stringify({
		nodes: [
			{ id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 }, children: [2, 3] },
			// 自分のコード。**これが「直しに行ける場所」に出るはず**
			{ id: 2, callFrame: { functionName: 'slowThing', url: 'file:///w/src/slow.ts', lineNumber: 41 } },
			// ランタイム。**こちらは混ぜてはいけない**
			{ id: 3, callFrame: { functionName: 'normalizeString', url: 'node:path', lineNumber: 90 } }
		],
		samples: [2, 3],
		timeDeltas: [8000, 2000],
		startTime: 0,
		endTime: 10000
	});
}

async function allEditorsText(page) {
	const texts = await page.evaluate(() =>
		[...document.querySelectorAll('.editor-instance .view-lines')].map((node) => node.innerText)
	);
	return texts.join('\n---\n').replace(/ /g, ' ');
}

async function waitForHeading(page, heading, { attempts = 12 } = {}) {
	let text = '';
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(700);
		text = await allEditorsText(page);
		if (text.includes(heading)) {
			return text;
		}
	}
	return text;
}

export default {
	name: '計測結果とターミナルの多分割',
	async run(page, ctx) {
		// 前のケースが残した文書を読まないように、先に片付ける
		await closeAllEditors(page);

		writeFileSync(join(ctx.workspace, 'run.cpuprofile'), sampleProfile());
		await page.waitForTimeout(1200);

		// --- 計測結果を渡す（見つかった 1 枚を選ぶ）
		await runCommand(page, labels('command.importCpuProfile')[0]);
		await page.waitForTimeout(900);
		const picker = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		ctx.expect(
			picker.includes('run.cpuprofile'),
			`置いた計測結果が一覧に出ない（実際: ${picker.slice(0, 160).replace(/\n/g, ' ')}）`
		);
		await page.keyboard.press('Enter');

		const report = await waitForHeading(page, '計測結果');
		ctx.expect(report.includes('計測結果'), `計測結果が開かない（実際: ${report.slice(0, 160)}）`);
		ctx.expect(report.includes('slowThing'), '自分のコードが出ていない');
		// 直せる場所とそれ以外を分けているか。混ざっていたら意味が無い
		const own = report.indexOf('直しに行ける場所');
		const others = report.indexOf('直接は直せない');
		ctx.expect(own >= 0 && others > own, `直せる場所とそれ以外が分かれていない（実際: ${report.slice(0, 300).replace(/\n/g, ' ')}）`);
		ctx.expect(
			report.indexOf('normalizeString') > others,
			'ランタイムの関数が「直しに行ける場所」に混ざっている'
		);

		// --- ターミナルを並べる（枚数を聞かれる。2 枚なら幅は足りるので、減らす確認は出ない）
		const before = await page.evaluate(
			() => document.querySelectorAll('.terminal-wrapper, .pane-body .xterm').length
		);
		await runCommand(page, labels('command.splitTerminals')[0]);
		await page.waitForTimeout(900);
		const countPicker = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		ctx.expect(countPicker.includes('2 枚'), `枚数の選択が出ない（実際: ${countPicker.slice(0, 160).replace(/\n/g, ' ')}）`);
		await page.keyboard.press('Enter');

		// 幅が足りなければ「減らしました」と聞かれる。出たら、そのまま進める
		await page.waitForTimeout(1500);
		let after = before;
		for (let i = 0; i < 10; i++) {
			await page.waitForTimeout(800);
			after = await page.evaluate(
				() => document.querySelectorAll('.terminal-wrapper, .pane-body .xterm').length
			);
			if (after > before) {
				break;
			}
		}
		ctx.expect(after > before, `ターミナルが増えていない（前 ${before} / 後 ${after}）`);

		await ctx.shot('profile-and-terminals');
		const leftover = await closeAllEditors(page);
		ctx.expect(leftover === 0, `文書を閉じきれていない（${leftover} 個。次のケースを汚す）`);
	}
};
