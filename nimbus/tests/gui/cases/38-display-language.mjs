/**
 * 表示言語の既定が日本語になっているか（T-245）。
 *
 * 拡張の文言だけ日本語で、コア側（エクスプローラー・検索・設定画面）が英語のままだった。
 * upstream は locale の指定が無いと NLS の解決自体を行わないので、OS が日本語でも英語で立ち上がる。
 *
 * ここは**実際にアプリを起ち上げて、画面の文字を読む**。同梱しただけ・既定値を書いただけでは
 * 日本語にならないため（言語パックの所在は利用者データの `languagepacks.json` を見て解決され、
 * そのファイルは拡張を走査したあとに書かれる。だから真っさらな設定では 1 回目が英語になる）。
 *
 * 開発ビルドは `VSCODE_DEV` があると upstream 側で英語に短絡するので、**パッケージ版でだけ**確かめる。
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
/**
 * このケースは自分でアプリを起ち上げるので、`run.mjs` と**同じアプリ**を見る必要がある。
 * 既定の `../Nimbus-darwin-arm64` を直に見ていると、別のセッションが作り直している最中に
 * 半端なアプリを掴んで落ちる（実測。T-276）。写しを指しているときはそちらを使う。
 */
const APP_ROOT = process.env['NIMBUS_APP'] ?? join(dirname(ROOT), 'Nimbus-darwin-arm64', 'Nimbus.app');
const APP = join(APP_ROOT, 'Contents', 'MacOS', 'Nimbus');
const PACK = join(APP_ROOT, 'Contents', 'Resources', 'app', 'extensions', 'MS-CEINTL.vscode-language-pack-ja');

/** アクティビティバーの読み上げ名。コアが訳す文字なので、言語の判定に使える */
async function activityBarLabels(page) {
	return page.evaluate(() =>
		[...document.querySelectorAll('.activitybar [aria-label]')]
			.map((el) => el.getAttribute('aria-label') ?? '')
			.join(' | ')
	);
}

/** 使い捨ての設定フォルダで 1 回起ち上げて、アクティビティバーの文字を読む */
async function launchAndRead(electron, userDataDir, workspace, extraArgs = []) {
	const app = await electron.launch({
		executablePath: APP,
		args: [
			`--user-data-dir=${userDataDir}`,
			`--extensions-dir=${mkdtempSync(join(tmpdir(), 'nimbus-lang-ext-'))}`,
			...extraArgs,
			'--disable-workspace-trust',
			'--skip-release-notes',
			'--skip-welcome',
			'--disable-updates',
			'--no-cached-data',
			workspace
		],
		env: (() => {
			const env = { ...process.env, NIMBUS_SMOKE: '1' };
			delete env.NODE_OPTIONS;
			return env;
		})(),
		timeout: 120000
	});
	const page = await app.firstWindow({ timeout: 120000 });
	await page.waitForSelector('.monaco-workbench', { timeout: 120000 });
	await page.waitForTimeout(7000);
	const labels = await activityBarLabels(page);
	await app.close();
	await new Promise((done) => setTimeout(done, 2500));
	return labels;
}

export default {
	name: '既定の表示言語が日本語になる',
	packagedOnly: true,
	async run(page, ctx) {
		ctx.expect(existsSync(PACK), `言語パックがアプリに同梱されていない: ${PACK}`);

		const { _electron: electron } = await import('playwright');
		// 走っている本体とは別の設定フォルダを使う。同じにすると二重起動が既存ウィンドウに吸われる
		const userDataDir = mkdtempSync(join(tmpdir(), 'nimbus-lang-ud-'));
		const workspace = mkdtempSync(join(tmpdir(), 'nimbus-lang-ws-'));

		// 1 回目は英語でよい（言語パックの所在がまだ書かれていない）。2 回目から日本語になる
		await launchAndRead(electron, userDataDir, workspace);
		const second = await launchAndRead(electron, userDataDir, workspace);
		ctx.expect(
			second.includes('エクスプローラー') && second.includes('検索'),
			`2 回目の起動でもコア側が日本語になっていない:\n${second.slice(0, 300)}`
		);

		// 変えたい人は変えられること。ここが効かないと英語で使えなくなる
		const english = await launchAndRead(electron, userDataDir, workspace, ['--locale', 'en']);
		ctx.expect(
			english.includes('Explorer'),
			`--locale en を渡しても英語に戻らない:\n${english.slice(0, 300)}`
		);
	}
};
