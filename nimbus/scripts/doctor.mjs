/**
 * Nimbus のドクター（健康診断）。
 *
 *   node nimbus/scripts/doctor.mjs            # 人が読む形式
 *   node nimbus/scripts/doctor.mjs --json     # 機械が読む形式
 *   node nimbus/scripts/doctor.mjs orphans deps   # 検査を選ぶ
 *
 * 見るのは **Nimbus が書いた部分だけ**（`extensions/nimbus/` と `nimbus/`）。
 * upstream の `src/vs` まで見ると指摘が洪水になり、肝心の問題が埋もれるため。
 *
 * 方針: 機械が確実に言えることだけを言う。「たぶん不要」は出さない。
 * 迷うものは `warn`（参考）にし、`error`（要対応）と混ぜない。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(ROOT, 'extensions', 'nimbus');
const EXT_SRC = join(EXT, 'src');

const findings = [];
const add = (check, level, message, detail) => findings.push({ check, level, message, detail });

// ---------------------------------------------------------------- 小道具

function walk(dir, filter = () => true) {
	if (!existsSync(dir)) {
		return [];
	}
	const out = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === 'node_modules' || entry.name === 'out' || entry.name === 'dist') {
				continue;
			}
			out.push(...walk(full, filter));
		} else if (filter(full)) {
			out.push(full);
		}
	}
	return out;
}

const rel = (path) => relative(ROOT, path);
const readIfExists = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');

function git(args) {
	try {
		return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return '';
	}
}

/** import 文（と require）から参照先を集める。自分たちのコードは素直な書き方しかしていない */
function importsOf(file) {
	const source = readFileSync(file, 'utf8');
	const specifiers = [];
	const patterns = [/\bfrom\s+['"]([^'"]+)['"]/g, /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g, /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g];
	for (const re of patterns) {
		for (const match of source.matchAll(re)) {
			specifiers.push(match[1]);
		}
	}
	return specifiers;
}

/** 相対 import を実ファイルへ解決する（拡張子省略・index を考慮） */
function resolveLocal(fromFile, specifier) {
	if (!specifier.startsWith('.')) {
		return undefined;
	}
	const base = resolve(dirname(fromFile), specifier);
	const candidates = [base, `${base}.ts`, `${base}.mts`, join(base, 'index.ts')];
	// `./x.js` と書かれていても TypeScript の実体は `./x.ts`
	if (base.endsWith('.js')) {
		candidates.push(`${base.slice(0, -3)}.ts`);
	}
	return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

// ---------------------------------------------------------------- 検査

/** 1. どこからも辿れない TypeScript モジュール */
function checkOrphanModules() {
	const manifest = JSON.parse(readFileSync(join(EXT, 'package.json'), 'utf8'));
	const entries = [join(EXT_SRC, 'extension.ts')];
	entries.push(...walk(join(EXT_SRC, 'test'), (f) => f.endsWith('.test.ts')));
	// esbuild の entryPoints も入口
	for (const match of readIfExists(join(EXT, 'esbuild.mts')).matchAll(/join\(srcDir,\s*'([^']+)'\)/g)) {
		entries.push(join(EXT_SRC, match[1]));
	}
	void manifest;

	const reached = new Set();
	const queue = entries.filter((e) => existsSync(e));
	while (queue.length > 0) {
		const file = queue.pop();
		if (reached.has(file)) {
			continue;
		}
		reached.add(file);
		for (const specifier of importsOf(file)) {
			const target = resolveLocal(file, specifier);
			if (target && !reached.has(target)) {
				queue.push(target);
			}
		}
	}

	for (const file of walk(EXT_SRC, (f) => extname(f) === '.ts')) {
		if (!reached.has(file)) {
			add('orphans', 'error', 'どこからも import されていないモジュール', rel(file));
		}
	}
}

/** 2. 使われていない依存 */
function checkUnusedDependencies() {
	const manifest = JSON.parse(readFileSync(join(EXT, 'package.json'), 'utf8'));
	const sources = walk(EXT_SRC, (f) => extname(f) === '.ts').map((f) => readFileSync(f, 'utf8')).join('\n');
	for (const name of Object.keys(manifest.dependencies ?? {})) {
		if (!sources.includes(`'${name}'`) && !sources.includes(`"${name}"`) && !sources.includes(`${name}/`)) {
			add('deps', 'error', '宣言されているが import されていない依存', name);
		}
	}
}

/** 3. package.json の宣言と実装のズレ（コマンド・ビュー・設定） */
/**
 * ソースの中で「このビューにプロバイダを付けた」と言えている ID を集める（T-284）。
 *
 * **登録のしかたは 1 つではない。** 見落とすと、動いているビューを
 * 「登録していない」と言ってしまい、直っているものを直させることになる。
 */
export function viewProviderIds(sources) {
	return new Set([
		...[...sources.matchAll(/register(?:WebviewViewProvider|TreeDataProvider)\(\s*'([^']+)'/g)].map((m) => m[1]),
		// `createTreeView('id', { treeDataProvider })` も登録の一種
		...[...sources.matchAll(/createTreeView\(\s*'([^']+)'/g)].map((m) => m[1]),
		// `X.viewType` 経由の登録は定数の中身を見る
		...[...sources.matchAll(/viewType\s*=\s*'([^']+)'/g)].map((m) => m[1])
	]);
}

/**
 * ソースから「実際に読んでいる nimbus.* 設定キー」を拾う（T-323）。
 *
 * strict: `getConfiguration('nimbus')` に直に続く読みと、`config.` 経由の読みだけ。
 *         「読んでいるのに宣言が無い」（error）の判定に使う — ここを緩めると、
 *         他の名前空間の読みを nimbus のものと誤認して偽の error を作る。
 * loose:  strict に加えて、`getConfiguration('nimbus')` を変数に受けてからの読みも拾う。
 *         「宣言されているが読まれていない」（warn）の判定に使う —
 *         読んでいるのに読んでいないと言わないため。
 *
 * 読みの形は `.get('key')` / `.get<T>('key')` / `.inspect<T>('key')`。
 * ジェネリクスは `Record<string, string>` のように入れ子になるので、`<[^(]*>` で開き括弧の
 * 手前まで飛ばす（`<[^>]*>` だと最初の `>` で切れて入れ子を読めない）。
 */
export function settingReadKeys(sources) {
	const READ = String.raw`\.(?:get|inspect)(?:<[^(]*>)?\(\s*'([^']+)'`;
	const keysOf = (patterns) => new Set(
		patterns.flatMap((re) => [...sources.matchAll(re)].map((m) => `nimbus.${m[1]}`))
	);
	const strictPatterns = [
		new RegExp(String.raw`getConfiguration\(\s*'nimbus'\s*\)[\s\S]{0,80}?` + READ, 'g'),
		new RegExp(String.raw`\bconfig` + READ, 'g')
	];
	const vars = [...new Set(
		[...sources.matchAll(/(?:const|let|var)\s+([\w$]+)\s*=\s*[\w$.]*getConfiguration\(\s*'nimbus'\s*\)/g)]
			.map((m) => m[1])
	)].filter((v) => v !== 'config');
	const varPatterns = vars.length === 0 ? [] : [
		new RegExp(String.raw`\b(?:${vars.join('|')})` + READ, 'g')
	];
	return { strict: keysOf(strictPatterns), loose: keysOf([...strictPatterns, ...varPatterns]) };
}

function checkContributesDrift() {
	const manifest = JSON.parse(readFileSync(join(EXT, 'package.json'), 'utf8'));
	const contributes = manifest.contributes ?? {};
	const sources = walk(EXT_SRC, (f) => extname(f) === '.ts').map((f) => readFileSync(f, 'utf8')).join('\n');

	// コマンド: 宣言 ⇄ registerCommand
	const declaredCommands = new Set((contributes.commands ?? []).map((c) => c.command));
	const registered = new Set([...sources.matchAll(/registerCommand\(\s*'([^']+)'/g)].map((m) => m[1]));
	for (const id of declaredCommands) {
		if (!registered.has(id)) {
			add('contributes', 'error', 'package.json で宣言されているが登録されていないコマンド', id);
		}
	}
	for (const id of registered) {
		if (!declaredCommands.has(id)) {
			add('contributes', 'error', '登録されているが package.json に宣言が無いコマンド', id);
		}
	}

	// ビュー: 宣言 ⇄ プロバイダ登録
	// ビューは複数のコンテナに分かれている（サイドバーと下部パネル）
	const declaredViews = Object.values(contributes.views ?? {}).flat().map((v) => v.id);
	const providerIds = viewProviderIds(sources);
	for (const id of declaredViews) {
		if (!providerIds.has(id)) {
			add('contributes', 'error', '宣言されているがプロバイダを登録していないビュー', id);
		}
	}

	// 設定: 宣言 ⇄ 実際に読んでいるキー
	const declaredSettings = Object.keys(contributes.configuration?.properties ?? {});
	const reads = settingReadKeys(sources);
	for (const key of declaredSettings) {
		if (!reads.loose.has(key)) {
			add('contributes', 'warn', '宣言されているが読まれていない設定（ドキュメント用途なら可）', key);
		}
	}
	for (const key of reads.strict) {
		if (!declaredSettings.includes(key)) {
			add('contributes', 'error', '読んでいるが package.json に宣言が無い設定', key);
		}
	}

	// メニューが参照するコマンドの実在
	for (const [menu, items] of Object.entries(contributes.menus ?? {})) {
		for (const item of items) {
			if (item.command && !declaredCommands.has(item.command)) {
				add('contributes', 'error', `メニュー(${menu})が存在しないコマンドを参照している`, item.command);
			}
		}
	}
}

/**
 * 3.5 重複した実装。
 *
 * 同じことをする実装が 2 つあると、片方だけ直して片方が腐る。
 * ここでは **機械が確実に言えるものだけ**を出す:
 *   - 同名の export が複数のモジュールにある
 *   - 正規化して 6 行以上そっくり同じブロックがある
 *   - 利用者に見える文字列が複数箇所に直書きされている
 *
 * 「似ているが同じではない」は出さない。判断が要るものは refactor スキルの仕事。
 */
const DUP_BLOCK_LINES = 6;

function normalizeForCompare(line) {
	const trimmed = line.trim();
	if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
		return undefined;
	}
	// 空白の違いは無視する。識別子までは潰さない（潰すと別物まで同じに見える）
	return trimmed.replace(/\s+/g, ' ');
}

function checkDuplication() {
	const files = walk(EXT_SRC, (f) => extname(f) === '.ts' && !f.endsWith('.test.ts'));

	// (a) 同名 export
	const exportsByName = new Map();
	for (const file of files) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|interface|type)\s+([A-Za-z0-9_]+)/gm)) {
			const list = exportsByName.get(match[1]) ?? [];
			list.push(rel(file));
			exportsByName.set(match[1], list);
		}
	}
	for (const [name, where] of exportsByName) {
		if (where.length > 1) {
			// **参考にとどめる**（T-296）。同名 export は意図してそうしていることも多く、
			// 直すかは人が決める（T-234）。要対応にしていたので毎回赤くなり、
			// 「赤いのが普通」になって**本物の指摘が埋もれた**（実際に T-284 がそうだった）
			add('duplication', 'warn', `同じ名前の export が ${where.length} 箇所にある`, `${name} — ${where.join(' / ')}`);
		}
	}

	// (b) そっくり同じブロック
	const seen = new Map();
	for (const file of files) {
		const lines = readFileSync(file, 'utf8').split('\n');
		const kept = [];
		lines.forEach((line, index) => {
			const normalized = normalizeForCompare(line);
			if (normalized !== undefined) {
				kept.push({ text: normalized, line: index + 1 });
			}
		});
		for (let i = 0; i + DUP_BLOCK_LINES <= kept.length; i++) {
			const window = kept.slice(i, i + DUP_BLOCK_LINES);
			// 閉じ括弧だけのような、意味の無い並びは数えない
			if (window.filter((w) => w.text.length > 3).length < DUP_BLOCK_LINES - 1) {
				continue;
			}
			const key = window.map((w) => w.text).join('\n');
			const list = seen.get(key) ?? [];
			list.push(`${rel(file)}:${window[0].line}`);
			seen.set(key, list);
		}
	}
	const reported = new Set();
	for (const [key, where] of seen) {
		if (where.length < 2) {
			continue;
		}
		// 重なり合う窓は 1 件にまとめる（同じ重複を何度も報告しない）
		const signature = where.map((w) => w.split(':')[0]).sort().join('|');
		if (reported.has(signature)) {
			continue;
		}
		reported.add(signature);
		add(
			// ここも参考（T-296）。まとめるかどうかは `refactor` スキルの判断
			'duplication',
			'warn',
			`${DUP_BLOCK_LINES} 行以上そっくり同じ実装が ${where.length} 箇所にある`,
			`${where.join(' / ')}\n           ${key.split('\n')[0].slice(0, 80)} …`
		);
	}

	// (c) 利用者に見える文字列の直書き重複
	const messages = new Map();
	for (const file of files) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/'([^'\\]{12,})'/g)) {
			const text = match[1];
			// 日本語を含むもの＝利用者に見える文言とみなす
			if (!/[぀-ヿ一-龯]/.test(text)) {
				continue;
			}
			const list = messages.get(text) ?? [];
			if (!list.includes(rel(file))) {
				list.push(rel(file));
			}
			messages.set(text, list);
		}
	}
	for (const [text, where] of messages) {
		if (where.length > 1) {
			add('duplication', 'warn', '同じ文言が複数ファイルに直書きされている', `"${text.slice(0, 40)}…" — ${where.join(' / ')}`);
		}
	}
}

/**
 * 3.6 テストが無いモジュール。
 *
 * 「テストを書く価値があるのに書かれていない」ものだけを出す:
 *   - `vscode` に依存していない（拡張ホスト無しで動かせる）
 *   - 実行時の export がある（型だけのファイルは対象外）
 * この 2 つを満たすのに、どのテストからも import されていないものが対象。
 *
 * `vscode` に依存するモジュールはモジュールテストでは扱えない。
 * 画面で確かめるべきものとして GUI テストの担当にする（ここでは参考として出す）。
 */
function analyzeModules() {
	const files = walk(EXT_SRC, (f) => extname(f) === '.ts' && !f.endsWith('.test.ts'));
	const info = new Map();
	for (const file of files) {
		const source = readFileSync(file, 'utf8');
		info.set(file, {
			importsVscode: /from\s+'vscode'/.test(source),
			hasRuntimeExport: /^export\s+(?:async\s+)?(?:function|const|class|enum)\s/m.test(source),
			localImports: importsOf(file)
				.map((spec) => resolveLocal(file, spec))
				.filter(Boolean)
		});
	}
	// vscode 依存は伝播する（vscode 依存モジュールを読む側も拡張ホストが要る）
	let changed = true;
	while (changed) {
		changed = false;
		for (const [, entry] of info) {
			if (entry.importsVscode) {
				continue;
			}
			if (entry.localImports.some((dep) => info.get(dep)?.importsVscode)) {
				entry.importsVscode = true;
				changed = true;
			}
		}
	}
	return info;
}

function checkTestCoverage() {
	const info = analyzeModules();
	const testFiles = walk(join(EXT_SRC, 'test'), (f) => f.endsWith('.test.ts'));

	// テストが何を import しているか
	const tested = new Set();
	const scaffoldOnly = new Set();
	for (const testFile of testFiles) {
		const source = readFileSync(testFile, 'utf8');
		// 雛形のまま（todo だけ）のテストは「書かれた」と見なさない
		const isScaffold = /todo:\s*(?:true|')/.test(source) && !/\btest\('(?!.*todo)/.test(source);
		for (const spec of importsOf(testFile)) {
			const target = resolveLocal(testFile, spec);
			if (target) {
				(isScaffold ? scaffoldOnly : tested).add(target);
			}
		}
	}

	for (const [file, entry] of info) {
		if (!entry.hasRuntimeExport) {
			continue; // 型だけのファイル
		}
		if (entry.importsVscode) {
			if (!tested.has(file)) {
				add('coverage', 'warn', 'vscode に依存するためモジュールテストでは扱えない（GUI テストの担当）', rel(file));
			}
			continue;
		}
		if (tested.has(file)) {
			continue;
		}
		if (scaffoldOnly.has(file)) {
			add('coverage', 'error', 'テストが雛形のまま（振る舞いが書かれていない）', rel(file));
			continue;
		}
		add('coverage', 'error', 'テストが無い（`node nimbus/scripts/scaffold-test.mjs` で雛形を作れる）', rel(file));
	}
}

/** 4. どこからも参照されていない同梱アセット */
function checkUnreferencedAssets() {
	const manifest = readFileSync(join(EXT, 'package.json'), 'utf8');
	const sources = walk(EXT_SRC, (f) => extname(f) === '.ts').map((f) => readFileSync(f, 'utf8')).join('\n');
	const haystack = `${manifest}\n${sources}\n${walk(join(EXT, 'media')).map((f) => readIfExists(f)).join('\n')}`;
	for (const dir of ['media', 'resources', 'themes']) {
		for (const file of walk(join(EXT, dir))) {
			const name = file.slice(file.lastIndexOf(sep) + 1);
			if (!haystack.includes(name)) {
				add('assets', 'error', 'どこからも参照されていない同梱ファイル', rel(file));
			}
		}
	}
}

/** 5. git 管理下に紛れ込んだ生成物・OS のゴミ */
function checkTrackedArtifacts() {
	const tracked = git(['ls-files', 'extensions/nimbus', 'nimbus']).split('\n').filter(Boolean);
	const bad = [
		[/(^|\/)out\//, 'ビルド生成物'],
		[/(^|\/)dist\//, 'ビルド生成物'],
		[/\.tsbuildinfo$/, 'ビルド生成物'],
		[/(^|\/)\.DS_Store$/, 'OS のゴミ'],
		[/(^|\/)node_modules\//, '依存の実体'],
		[/(^|\/)branding\/out\//, '生成した素材の中間物']
	];
	for (const path of tracked) {
		for (const [re, why] of bad) {
			if (re.test(path)) {
				add('artifacts', 'error', `${why}が git に含まれている`, path);
				break;
			}
		}
	}
	// 作業ツリーに残った大きなゴミ（コミットはされていないが掃除の対象）
	for (const path of git(['status', '--porcelain', '--ignored', 'extensions/nimbus', 'nimbus']).split('\n')) {
		if (path.startsWith('!! ') && /\/(out|dist)\//.test(path)) {
			continue; // 生成物は .gitignore 済みなら正常
		}
	}
}

/**
 * 6. upstream のファイルに入れた変更と、台帳（core-changes.md）のズレ
 *
 * 基点は台帳の `<!-- nimbus:base <sha> -->` を正とする。`merge-base` で求めると、
 * 追従の仕方によっては upstream 自身のコミットまで「我々の変更」に混ざる（実際に混ざった）。
 *
 * 新規追加したファイル（A）は upstream への変更ではないので台帳は要らない。
 * 台帳が要るのは **upstream のファイルを書き換えた／消した（M / D）** ものだけ。
 */
function checkCoreLedger() {
	const ledger = readIfExists(join(ROOT, 'nimbus', 'docs', 'core-changes.md'));
	const base = /<!--\s*nimbus:base\s+([0-9a-f]{7,40})\s*-->/.exec(ledger)?.[1];
	if (!base) {
		add('ledger', 'warn', '台帳に基点コミット（nimbus:base）が書かれていないため照合を飛ばした', 'nimbus/docs/core-changes.md');
		return;
	}
	if (!git(['cat-file', '-e', `${base}^{commit}`]) && git(['rev-parse', '--verify', `${base}^{commit}`]).trim() === '') {
		add('ledger', 'warn', '基点コミットが手元に無いため照合を飛ばした', base);
		return;
	}

	const entries = git(['diff', '--name-status', `${base}..HEAD`])
		.split('\n')
		.filter(Boolean)
		.map((line) => {
			const [status, ...rest] = line.split('\t');
			return { status: status[0], path: rest[rest.length - 1] };
		})
		.filter((e) => !e.path.startsWith('extensions/nimbus/') && !e.path.startsWith('nimbus/'));

	const modified = entries.filter((e) => e.status === 'M' || e.status === 'D');

	/**
	 * 台帳に載っているかを見る。ディレクトリごと消した場合（例: `extensions/copilot/`）は、
	 * 中の 4000 個のファイルを 1 件ずつ指摘しても読めないので、**祖先ディレクトリの記載で足りる**とする。
	 */
	const coveredByLedger = (path) => {
		const name = path.slice(path.lastIndexOf('/') + 1);
		if (ledger.includes(path) || ledger.includes(name)) {
			return true;
		}
		const segments = path.split('/');
		for (let i = segments.length - 1; i > 0; i--) {
			if (ledger.includes(`${segments.slice(0, i).join('/')}/`)) {
				return true;
			}
		}
		return false;
	};

	for (const { path } of modified) {
		if (!coveredByLedger(path)) {
			add('ledger', 'error', 'upstream のファイルを変更しているのに台帳に記載が無い', path);
		}
	}

	/**
	 * 台帳に載っているのに、もう差分が無いもの。
	 *
	 * **これは赤で落とす**（T-274 ③）。台帳に載っている＝ upstream のファイルへ Nimbus の変更を
	 * 入れたということなので、差分が消えているなら**その変更が落ちている**。
	 * upstream 追従のたびに起こりうるうえ、落ちても画面は動いてしまうので、
	 * 誰も気づかないまま機能だけが消える。警告では見落とす。
	 *
	 * 判定は「基点から**まったく触られていない**」で行う。Nimbus が新しく足したファイル（A）は
	 * upstream への変更ではないので、ここで数えると全部が赤になる。
	 * ディレクトリの記載（末尾が `/`）は、その下の何かが触られていれば足りているとみなす。
	 */
	const allChanged = new Set(entries.map((e) => e.path));
	const touched = (path) => {
		if (allChanged.has(path)) {
			return true;
		}
		if (path.endsWith('/')) {
			for (const changed of allChanged) {
				if (changed.startsWith(path)) {
					return true;
				}
			}
		}
		return false;
	};
	for (const line of ledger.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| ---'))) {
		for (const match of line.matchAll(/`((?:src|build|resources|product)[^`]*?)`/g)) {
			const path = match[1];
			if (path.includes('...') || path.includes('*') || path.includes('$')) {
				continue;
			}
			if (existsSync(join(ROOT, path)) && !touched(path)) {
				add('ledger', 'error', '台帳に載っているのに upstream との差分が無い（Nimbus の変更が落ちている）', path);
			}
		}
	}
}

/** 7. ドキュメントと実装のズレ（設定名・コマンド名・相対リンク） */
function checkDocDrift() {
	const manifest = JSON.parse(readFileSync(join(EXT, 'package.json'), 'utf8'));
	const contributes = manifest.contributes ?? {};
	// `nimbus.xxx` は設定とは限らない。コマンド ID・ビュー ID も同じ形をしている。
	// さらにコア側（`src/vs/**`）に登録されるコマンドもあるので、コード中の文字列リテラルも拾う。
	const known = new Set([
		...Object.keys(contributes.configuration?.properties ?? {}),
		...(contributes.commands ?? []).map((c) => c.command),
		...Object.values(contributes.views ?? {}).flat().map((v) => v.id),
		...(contributes.viewsContainers?.activitybar ?? []).map((v) => `nimbus.${v.id}`),
		// `--untracked` を付ける。並行作業中（まだコミットされていない）実装も「在る」と見なさないと、
		// 他のセッションが書いている途中の機能を毎回「存在しない ID」と誤検出してしまう
		...[...git(['grep', '-h', '-o', '--untracked', '-E', "'nimbus\\.[A-Za-z0-9._-]+'"]).matchAll(/'([^']+)'/g)].map(
			(m) => m[1]
		)
	]);
	const declaredSettings = known;
	const docs = [
		join(ROOT, 'README.md'),
		join(EXT_SRC, 'help', 'yua.ts'),
		...walk(join(ROOT, 'nimbus', 'docs'), (f) => f.endsWith('.md') && !f.includes(`${sep}history${sep}`))
	];
	for (const doc of docs) {
		const text = readIfExists(doc);
		// 設定名の実在
		for (const match of text.matchAll(/\bnimbus\.[a-zA-Z]+(?:\.[a-zA-Z]+)*\b/g)) {
			const key = match[0];
			if (key.startsWith('nimbus.docs') || key.startsWith('nimbus.scripts') || key.startsWith('nimbus.branding')) {
				continue; // ファイルパスの一部
			}
			if (!declaredSettings.has(key) && /^nimbus\.[a-z]/.test(key)) {
				add(
					'docs',
					'error',
					'設定・コマンド・ビューのどれにも無い ID に言及している',
					`${rel(doc)} → ${key}`
				);
			}
		}
		// 相対リンクの実在
		for (const match of text.matchAll(/\]\((\.{0,2}\/?[^)\s#]+\.(?:md|mjs|ts|sh|json|txt))\)/g)) {
			const target = resolve(dirname(doc), match[1]);
			if (!existsSync(target)) {
				add('docs', 'error', 'リンク先が存在しない', `${rel(doc)} → ${match[1]}`);
			}
		}
	}
}

// ---------------------------------------------------------------- 実行

const CHECKS = {
	orphans: ['どこからも辿れないモジュール', checkOrphanModules],
	deps: ['使われていない依存', checkUnusedDependencies],
	contributes: ['宣言と実装のズレ（コマンド/ビュー/設定）', checkContributesDrift],
	duplication: ['重複した実装', checkDuplication],
	coverage: ['テストが無いモジュール', checkTestCoverage],
	assets: ['参照されていない同梱ファイル', checkUnreferencedAssets],
	artifacts: ['git に紛れ込んだ生成物', checkTrackedArtifacts],
	ledger: ['コア変更と台帳のズレ', checkCoreLedger],
	docs: ['ドキュメントと実装のズレ', checkDocDrift]
};

/** CLI として走らせたときだけ検査する（テストから読み込むときは動かさない） */
function main() {
	const args = process.argv.slice(2);
	const asJson = args.includes('--json');
	const selected = args.filter((a) => !a.startsWith('--'));
	const toRun = selected.length > 0 ? selected : Object.keys(CHECKS);

	for (const name of toRun) {
		const entry = CHECKS[name];
		if (!entry) {
			console.error(`不明な検査: ${name}（使えるのは ${Object.keys(CHECKS).join(', ')}）`);
			process.exitCode = 2;
			return;
		}
		try {
			entry[1]();
		} catch (error) {
			add(name, 'error', '検査そのものが失敗した', error instanceof Error ? error.message : String(error));
		}
	}

	const errors = findings.filter((f) => f.level === 'error');
	const warns = findings.filter((f) => f.level === 'warn');

	if (asJson) {
		console.log(JSON.stringify({ findings, summary: { error: errors.length, warn: warns.length } }, null, 2));
	} else {
		for (const name of toRun) {
			const mine = findings.filter((f) => f.check === name);
			const [label] = CHECKS[name];
			if (mine.length === 0) {
				console.log(`✔ ${name} — ${label}`);
				continue;
			}
			console.log(`${mine.some((f) => f.level === 'error') ? '✖' : '△'} ${name} — ${label}`);
			for (const f of mine) {
				console.log(`    ${f.level === 'error' ? '要対応' : '参考  '} ${f.message}`);
				console.log(`           ${f.detail}`);
			}
		}
		console.log(`\n要対応 ${errors.length} 件 / 参考 ${warns.length} 件`);
	}

	// process.exit() にしない — 書き込み先がパイプだと stdout のフラッシュ前に死に、
	// --json が**途中で切れる**（execFileSync から呼ぶと 39265 文字が 7424 文字になった・実測 T-335）。
	// exitCode なら流し終えてから終わる
	process.exitCode = errors.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
