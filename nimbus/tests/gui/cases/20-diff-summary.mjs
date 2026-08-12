/**
 * 変更の要約（T-157）と生成物を畳むこと（T-140）の通し確認。
 *
 * 手書きの export は見出しに出て、生成物は畳まれることを、実際の git 差分で見る。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { activeEditorText, git, runCommand } from '../helpers.mjs';

export default {
	name: '変更の要約が export を出し、生成物を畳む',
	async run(page, ctx) {
		const ws = ctx.workspace;
		mkdirSync(join(ws, 'lib'), { recursive: true });
		// 土台をコミットしておく（差分として見えるようにする）
		writeFileSync(join(ws, 'lib/model.dart'), '// base\n');
		writeFileSync(join(ws, 'lib/model.g.dart'), '// base\n');
		git(ws, ['add', '--', 'lib/model.dart', 'lib/model.g.dart']);
		git(ws, ['commit', '-q', '-m', 'base']);

		// 手書きと生成物を、それぞれ変える
		writeFileSync(join(ws, 'lib/model.dart'), '// base\nexport function handWritten() {}\n');
		writeFileSync(join(ws, 'lib/model.g.dart'), '// base\nexport function generatedThing() {}\n');

		await runCommand(page, 'Nimbus: 変更の要約を見る');
		const text = await activeEditorText(page);

		ctx.expect(text.includes('変更の要約'), `要約が開いていない:\n${text.slice(0, 400)}`);
		// 手書きの export は「外から見える変化」に出る
		ctx.expect(text.includes('handWritten'), `手書きの export が出ていない:\n${text.slice(0, 800)}`);
		// 生成物は畳む。ただし隠さない（見出しと件数は出る）
		ctx.expect(text.includes('生成物'), `生成物の見出しが出ていない:\n${text.slice(0, 800)}`);
		ctx.expect(
			!text.includes('generatedThing'),
			`生成物の export が「外から見える変化」に混ざっている:\n${text.slice(0, 800)}`
		);
		await ctx.shot('diff-summary');
	}
};
