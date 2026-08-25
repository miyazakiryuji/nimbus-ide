/**
 * スキル検索の QuickPick（f3-f6.md §6 の 5 つめ・T-004）。
 *
 * 一覧に出ること自体は 05 が見ている。ここで確かめるのは**探せること** —
 * `nimbus.findSkill` を実行すると QuickPick が開き、**説明文への部分一致で絞り込める**こと。
 * 用意したスキルの説明文にしか無い語（「一覧表示」）で引けるかどうかで見る。
 * 名前だけで引けるなら普通の絞り込みと変わらず、この機能を入れた意味が無い。
 */
import { labels } from '../helpers.mjs';

export default {
	name: 'スキル検索が説明文で絞り込める',
	async run(page, ctx) {
		await page.keyboard.press('Escape');
		await page.waitForTimeout(300);
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
		await page.waitForTimeout(1000);
		await page.keyboard.type(labels('command.findSkill')[0], { delay: 20 });
		await page.waitForTimeout(1200);

		const palette = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		ctx.expect(
			labels('command.findSkill').some((label) => palette.includes(label)),
			`コマンドパレットに ${labels('command.findSkill').join(' / ')} が無い:\n${palette.slice(0, 400)}`
		);

		await page.keyboard.press('Enter');
		await page.waitForTimeout(1800);

		// 説明文にしか出てこない語で絞る（名前は gui-test-skill なので当たらない）
		await page.keyboard.type('一覧表示', { delay: 30 });
		await page.waitForTimeout(1500);
		const filtered = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		await page.keyboard.press('Escape');
		await page.waitForTimeout(400);

		ctx.expect(
			filtered.includes('gui-test-skill'),
			`説明文での絞り込みが効いていない（「一覧表示」で gui-test-skill が出ない）:\n${filtered.slice(0, 400)}`
		);
		await ctx.shot('skill-quickpick');
	}
};
