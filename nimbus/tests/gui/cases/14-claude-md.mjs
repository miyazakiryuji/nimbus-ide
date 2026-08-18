/**
 * CLAUDE.md タブ（`nimbus/docs/testing/claude-md.md` §2 の B-1 / B-2 / B-4 / B-5 / B-10 / B-11 / B-13）。
 *
 * 使い捨てワークスペースに**自前の CLAUDE.md を書いてから**確かめる。
 * 利用者の `~/.claude/CLAUDE.md` に頼ると、環境によって中身が変わるうえ、
 * 個人の設定をテストの前提にしてしまうため。
 *
 * B-13（何度も言っている指示）は過去の記録がある環境でしか出ない。
 * 使い捨てワークスペースには記録が無いので、**出ていなくても失敗にしない** —
 * 出ていたときだけ形を確かめる。
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandPane, labels, openHiddenView, openNimbusSettingsSidebar, runCommand, sidebarText } from '../helpers.mjs';

/** 節・コードブロック・重複見出し（指摘を出すため）を仕込んだ CLAUDE.md */
const CONTENT = [
	'# GUI テスト用',
	'',
	'## 決まりごと',
	'',
	'守ること。',
	'',
	'## コード例',
	'',
	'次はコードブロックなので、節として並んではいけない。',
	'',
	'```sh',
	'# コードブロック内の見出しもどき',
	'echo hi',
	'```',
	'',
	'## 決まりごと',
	'',
	'見出しが重複しているので、リンターが指摘するはず。',
	''
].join('\n');

export default {
	name: 'CLAUDE.md タブに節と指摘が並ぶ',
	async run(page, ctx) {
		writeFileSync(join(ctx.workspace, 'CLAUDE.md'), CONTENT, 'utf8');
		await runCommand(page, labels('command.refreshClaudeMd')[0]);

		ctx.expect(await openNimbusSettingsSidebar(page), 'Nimbus 設定のサイドバーを開けない');
		// CLAUDE.md は既定で出していない（T-239）。コマンドから開く
		await openHiddenView(page, 'CLAUDE.md を開く');
		await expandPane(page, labels('view.nimbus.claudeMd')[0]);
		await page.waitForTimeout(1500);

		const text = await sidebarText(page);
		const show = text.slice(0, 900);

		// B-1: 効いている CLAUDE.md が並ぶ
		ctx.expect(text.includes('CLAUDE.md'), `CLAUDE.md のビューが出ていない:\n${show}`);
		// B-4: 見出しが節として並ぶ
		ctx.expect(text.includes('決まりごと'), `節「決まりごと」が並んでいない:\n${show}`);
		ctx.expect(text.includes('コード例'), `節「コード例」が並んでいない:\n${show}`);
		// B-5: コードブロック内の # は節にしない
		ctx.expect(
			!text.includes('コードブロック内の見出しもどき'),
			`コードブロック内の # が節として並んでいる:\n${show}`
		);
		// B-10: 分量が分かる
		ctx.expect(/約\s*[\d.,]+\s*(k)?トークン/.test(text), `「約 N トークン」が出ていない:\n${show}`);
		// B-11: 指摘が節より先に出る
		const lint = text.indexOf('件の指摘');
		ctx.expect(lint >= 0, `重複した見出しがあるのに「N 件の指摘」が出ていない:\n${show}`);
		ctx.expect(
			lint < text.indexOf('決まりごと'),
			`「N 件の指摘」が節より後ろに出ている（先に読ませたい）:\n${show}`
		);

		// B-13: 記録がある環境でだけ出る。出たときだけ形を見る
		const repeated = /何度も言っている指示（(\d+) 件）/.exec(text);
		if (repeated) {
			ctx.expect(Number(repeated[1]) > 0, `「何度も言っている指示」が 0 件で出ている:\n${show}`);
		}

		await ctx.shot('claude-md');
	}
};
