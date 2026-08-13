/**
 * スキーマ差分と「出す前に」が、実際の作業ツリーから中身を出すか。
 *
 * 仕様側の「画面確認（未実施）」を閉じる:
 * [schema-diff](../../../docs/specs/schema-diff.md) / [preflight](../../../docs/specs/preflight.md)。
 *
 * **実セッション（課金）は要らない。** どちらも git と手元のファイルしか読まない。
 *
 * ここで見たいのは「開くか」だけではない。**判断が実際に効いているか**を見る:
 *   - スキーマ差分 — 消える列を「戻せない変更」として、手順より**先に**出すか
 *   - 出す前に — 走らせていない確認を `ok` にせず、**まだ出せないと言うか**
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, git, labels, runCommand } from '../helpers.mjs';

/** 開いているエディタを全部読む（タブが積み上がるので、最初の 1 枚だけでは足りない） */
async function allEditorsText(page) {
	const texts = await page.evaluate(() =>
		[...document.querySelectorAll('.editor-instance .view-lines')].map((node) => node.innerText)
	);
	return texts.join('\n---\n').replace(/ /g, ' ');
}

/** 見出しが出るまで待つ */
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
	name: 'マイグレーションと「出す前に」が、作業ツリーの中身で動く',
	async run(page, ctx) {
		// 前のケースが残した文書を読まないように、先に片付ける
		await closeAllEditors(page);

		// 1 つ前の版を HEAD に置く（スキーマ差分は HEAD といまを見比べる）
		const schema = join(ctx.workspace, 'schema.sql');
		writeFileSync(
			schema,
			['CREATE TABLE users (', '  id INTEGER NOT NULL,', '  nickname TEXT,', '  PRIMARY KEY (id)', ');', ''].join('\n')
		);
		git(ctx.workspace, ['add', '-A']);
		git(ctx.workspace, ['commit', '-m', 'schema']);

		// 列を 1 つ消して、1 つ足す（消えるほうが「戻せない変更」に出るはず）
		writeFileSync(
			schema,
			['CREATE TABLE users (', '  id INTEGER NOT NULL,', '  email TEXT NOT NULL,', '  PRIMARY KEY (id)', ');', ''].join('\n')
		);
		await page.waitForTimeout(1200);

		// --- マイグレーションを起こす（.sql が 1 つなので聞かれない）
		await runCommand(page, labels('command.openMigrationPlan')[0]);
		const migration = await waitForHeading(page, 'マイグレーション');
		ctx.expect(migration.includes('マイグレーション'), `マイグレーションが開かない（実際: ${migration.slice(0, 160)}）`);
		ctx.expect(
			migration.includes('戻せない変更'),
			`消える列が「戻せない変更」に出ていない（実際: ${migration.slice(0, 300).replace(/\n/g, ' ')}）`
		);
		// 消すものより足すものが先（途中で止めても戻せる順）
		ctx.expect(
			migration.indexOf('戻せない変更') < migration.indexOf('## 手順'),
			'「戻せない変更」が手順より後ろに出ている'
		);
		ctx.expect(
			migration.indexOf('ADD COLUMN') < migration.indexOf('DROP COLUMN'),
			'手順が「足す → 消す」の順になっていない'
		);

		// --- 出す前に見る（最初に「どこまで見るか」を聞かれる。先頭＝軽いほうを選ぶ）
		await runCommand(page, labels('command.openPreflight')[0]);
		await page.waitForTimeout(900);
		const picker = await page.evaluate(() => document.querySelector('.quick-input-widget')?.innerText ?? '');
		ctx.expect(
			picker.includes('確かめずに分かることだけ見る'),
			`見かたの選択が出ない（実際: ${picker.slice(0, 160).replace(/\n/g, ' ')}）`
		);
		await page.keyboard.press('Enter');

		const preflight = await waitForHeading(page, '出す前に');
		ctx.expect(preflight.includes('出す前に'), `「出す前に」が開かない（実際: ${preflight.slice(0, 160)}）`);
		// テストもビルドも走らせていないので、「出せます」にはならない
		ctx.expect(
			preflight.includes('まだ確かめていません') || preflight.includes('まだ出せません'),
			`走らせていない確認が ok 扱いになっている（実際: ${preflight.slice(0, 300).replace(/\n/g, ' ')}）`
		);
		// schema.sql を直したまま（コミットしていない）ので、そこで止まるはず
		ctx.expect(
			preflight.includes('コミットしていない変更'),
			'コミットしていない変更が挙がっていない'
		);

		await ctx.shot('migration-and-preflight');
		const leftover = await closeAllEditors(page);
		ctx.expect(leftover === 0, `文書を閉じきれていない（${leftover} 個。次のケースを汚す）`);
	}
};
