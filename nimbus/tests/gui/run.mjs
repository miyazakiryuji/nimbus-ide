/**
 * GUI を実際に操作して確かめるテスト。
 *
 *   node nimbus/tests/gui/run.mjs                # 開発ビルドで実行
 *   node nimbus/tests/gui/run.mjs --packaged     # パッケージ版（Nimbus-darwin-arm64）で実行
 *   node nimbus/tests/gui/run.mjs --with-claude  # 実セッションの往復も確認する（課金が発生する）
 *   node nimbus/tests/gui/run.mjs --list         # ケース一覧だけ出す（起動しない）
 *   node nimbus/tests/gui/run.mjs --only theme   # 名前に一致するケースだけ
 *   node nimbus/tests/gui/run.mjs --untrusted    # 信頼していないフォルダでの見え方だけ
 *
 * ケースの足しかた: `cases/` に 1 ファイル増やすだけ。
 *   export default { name: '...', async run(page, ctx) { ... } }
 * 失敗は例外を投げる。`ctx.expect(条件, '説明')` を使うと理由が残る。
 *
 * 注意: これはウィンドウを開く。作業中の画面に割り込むので、意図したときだけ走らせる。
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');
const OUT = join(HERE, 'out');
/** 使い捨てワークスペースの「素の状態」。ケースの間でここへ戻す（T-240） */
const BASELINE_TAG = 'nimbus-gui-baseline';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

async function loadCases() {
	const files = readdirSync(join(HERE, 'cases')).filter((f) => f.endsWith('.mjs')).sort();
	const cases = [];
	for (const file of files) {
		const mod = await import(join(HERE, 'cases', file));
		const entry = mod.default;
		if (!entry?.name || typeof entry.run !== 'function') {
			throw new Error(`${file}: default export に { name, run } が必要です`);
		}
		cases.push({ ...entry, file });
	}
	return cases;
}

function resolveApp() {
	if (flag('packaged')) {
		// 複数のセッションが同じリポジトリで作業していると、走らせている最中に
		// 別のセッションが `../Nimbus-darwin-arm64` を作り直してしまう（実際に起きた）。
		// 自分の写しを指せるように env で差し替えられるようにしておく（T-240 と同じ「独立して走る」話）
		const custom = process.env['NIMBUS_APP'];
		const app = custom
			? join(custom, 'Contents', 'MacOS', 'Nimbus')
			: join(dirname(ROOT), 'Nimbus-darwin-arm64', 'Nimbus.app', 'Contents', 'MacOS', 'Nimbus');
		return { executablePath: app, label: custom ? 'パッケージ版（写し）' : 'パッケージ版' };
	}
	// 開発ビルド。scripts/code.sh が用意する Electron をそのまま使う
	const app = join(ROOT, '.build', 'electron', 'Nimbus.app', 'Contents', 'MacOS', 'Nimbus');
	return { executablePath: app, label: '開発ビルド', devMain: ROOT };
}

/** 使い捨てのワークスペースを作る。スキル一覧の確認用に 1 つスキルを置いておく */
function makeWorkspace() {
	const ws = mkdtempSync(join(tmpdir(), 'nimbus-gui-ws-'));
	writeFileSync(join(ws, 'hello.ts'), 'export const hello = "Nimbus"\n');
	const skillDir = join(ws, '.claude', 'skills', 'gui-test-skill');
	mkdirSync(skillDir, { recursive: true });
	writeFileSync(
		join(skillDir, 'SKILL.md'),
		'---\nname: gui-test-skill\ndescription: GUI テストが一覧表示を確かめるためのスキル\n---\n\n本文\n'
	);
	try {
		execFileSync('git', ['init', '-q'], { cwd: ws });
		// 置いたものを全部入れた「素の状態」を 1 つ作っておく（T-240）。
		// ケースの間でここへ戻せば、前のケースが残したファイルを次のケースが拾わない
		gitIn(ws, ['add', '-A']);
		gitIn(ws, ['commit', '-q', '-m', 'baseline']);
		gitIn(ws, ['tag', BASELINE_TAG]);
	} catch {
		// git が無くても大半のケースは動く
	}
	return ws;
}

/** ケースと同じ素性でコミットする（利用者の git 設定に依らない） */
function gitIn(cwd, args) {
	return execFileSync('git', args, {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'nimbus-gui',
			GIT_AUTHOR_EMAIL: 'gui@example.invalid',
			GIT_COMMITTER_NAME: 'nimbus-gui',
			GIT_COMMITTER_EMAIL: 'gui@example.invalid'
		}
	});
}

/**
 * ケースの間で作業ツリーを素の状態へ戻す（T-240）。
 *
 * ケースは 1 つの使い捨てワークスペースを共有している。前のケースが置いたファイルが
 * 残っていると、git の状態を読むケース（コミットの分けかた・差分の要約・レビュー）は
 * **単独では通るのにフル実行では落ちる**。実際にそれが起きていた。
 *
 * 戻せない（git が無い）ときは黙って先へ進む — 戻せないこと自体でテストを落とさない。
 */
function resetWorkspace(ws) {
	try {
		gitIn(ws, ['reset', '-q', '--hard', BASELINE_TAG]);
		// `-ff` まで付けるのは、入れ子の git リポジトリを置いていくケースがあるため。
		// `-x` は無視されるファイルも落とす。使い捨てのワークスペースなので惜しむものが無い
		gitIn(ws, ['clean', '-qffdx']);
	} catch (error) {
		// 戻せないこと自体でテストは落とさない。ただし**黙らない** —
		// 黙って戻らないと、後のケースが前のケースの残骸を拾って落ち、原因が分からなくなる
		console.log(`  ！ 作業ツリーを戻せませんでした: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function main() {
	const cases = await loadCases();
	const only = value('only');
	// 信頼を確かめるケースは起動のしかたが違うので、既定の一覧からは外す
	const forThisRun = cases.filter((c) => Boolean(c.untrusted) === flag('untrusted'));
	// 開発ビルドでは成り立たないものがある（表示言語は `VSCODE_DEV` があると upstream 側で
	// 英語に短絡する）。素通りさせると「確かめた」ことになってしまうので、**外したことを言う**
	const skipped = flag('packaged') ? [] : forThisRun.filter((c) => c.packagedOnly);
	const runnable = forThisRun.filter((c) => !skipped.includes(c));
	const selected = only
		? runnable.filter((c) => c.name.includes(only) || c.file.includes(only))
		: runnable;
	for (const c of skipped) {
		console.log(`  － ${c.name}（パッケージ版でだけ確かめる。--packaged で走ります）`);
	}

	if (flag('list')) {
		for (const c of cases) {
			console.log(`  ${c.file.padEnd(28)} ${c.name}`);
		}
		console.log(`\n${cases.length} 件`);
		return 0;
	}

	let electron;
	try {
		({ _electron: electron } = await import('playwright'));
	} catch {
		console.error('playwright がありません。次で入れてください:');
		console.error('  cd nimbus/tests/gui && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install');
		return 2;
	}

	const { executablePath, label, devMain } = resolveApp();
	const userDataDir = mkdtempSync(join(tmpdir(), 'nimbus-gui-ud-'));
	const extensionsDir = mkdtempSync(join(tmpdir(), 'nimbus-gui-ext-'));
	const workspace = makeWorkspace();
	mkdirSync(OUT, { recursive: true });

	// 既定では信頼の確認を切る。切らないと 21 件すべてがモーダル待ちになって不安定になる。
	// ただしそれだと「信頼していないときの見え方」を一度も通らないので、
	// `--untrusted` のときだけフラグを外し、そこを見るケースだけを走らせる
	const untrusted = flag('untrusted');
	const launchArgs = [
		...(devMain ? [devMain] : []),
		`--user-data-dir=${userDataDir}`,
		`--extensions-dir=${extensionsDir}`,
		...(untrusted ? [] : ['--disable-workspace-trust']),
		'--skip-release-notes',
		'--skip-welcome',
		'--disable-updates',
		'--no-cached-data',
		workspace
	];

	console.log(`起動: ${label}${untrusted ? '（信頼していない状態）' : ''}`);
	console.log(`  ${executablePath}`);
	console.log(`  ワークスペース: ${workspace}`);

	const env = { ...process.env, NIMBUS_SMOKE: '1' };
	delete env.NODE_OPTIONS; // 子プロセスに引き継ぐと無言で止まる（実測）
	if (devMain) {
		// ソースから起動するときは開発モードの環境変数が要る（scripts/code.sh と同じ）。
		// これが無いと本番ビルドとして読み込みにいき、CSS が JS モジュールとして
		// 取得されて MIME で弾かれ、workbench.desktop.main.js ごと読み込めない。
		// 症状は「.monaco-workbench が現れないまま 120 秒でタイムアウト」で、
		// 原因が分かりにくいので、ここで必ず付ける（実測で確認）
		env.VSCODE_DEV = '1';
		env.NODE_ENV = 'development';
		env.VSCODE_CLI = '1';
	}
	if (flag('with-claude')) {
		env.NIMBUS_SMOKE_PROMPT = 'Reply with exactly: NIMBUS_GUI_OK';
	}

	const app = await electron.launch({ executablePath, args: launchArgs, env, timeout: 120000 });
	const page = await app.firstWindow({ timeout: 120000 });
	await page.waitForSelector('.monaco-workbench', { timeout: 120000 });
	// 拡張が起動しきるまでの猶予（onStartupFinished）
	await page.waitForTimeout(8000);

	const ctx = {
		workspace,
		userDataDir,
		withClaude: flag('with-claude'),
		// 開発ビルドとパッケージ版で振る舞いが変わるものがある（表示言語など）
		packaged: flag('packaged'),
		expect(condition, description) {
			if (!condition) {
				throw new Error(description);
			}
		},
		async shot(name) {
			const file = join(OUT, `${name}.png`);
			await page.screenshot({ path: file });
			return file;
		}
	};

	const results = [];
	for (const c of selected) {
		const started = Date.now();
		// 前のケースが残したものを持ち越さない（T-240）
		resetWorkspace(workspace);
		try {
			await c.run(page, ctx);
			results.push({ name: c.name, ok: true, ms: Date.now() - started });
			console.log(`  ✔ ${c.name}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			let shot;
			try {
				shot = await ctx.shot(`失敗-${c.file.replace(/\.mjs$/, '')}`);
			} catch {
				// スクリーンショットが撮れなくても結果は残す
			}
			results.push({ name: c.name, ok: false, ms: Date.now() - started, message, shot });
			console.log(`  ✖ ${c.name}`);
			console.log(`      ${message}`);
			if (shot) {
				console.log(`      ${shot}`);
			}
		}
	}

	// 最後に全体像を 1 枚残す。人が後から見て気づけるようにするため
	try {
		const overview = await ctx.shot('overview');
		console.log(`\n全体: ${overview}`);
	} catch {
		// 撮れなくても失敗にはしない
	}

	await app.close().catch(() => undefined);
	for (const dir of [userDataDir, extensionsDir, workspace]) {
		rmSync(dir, { recursive: true, force: true });
	}

	const failed = results.filter((r) => !r.ok);
	console.log(`\n${results.length - failed.length}/${results.length} 通過`);
	return failed.length > 0 ? 1 : 0;
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error('GUI テストの実行そのものが失敗しました:');
		console.error(error);
		process.exit(1);
	}
);
