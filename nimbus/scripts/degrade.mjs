/**
 * デグレチェック — 基準（Before）と今（After）の突き合わせ（tasks.md T-335）。
 *
 * CLAUDE.md は「手を入れる前に Before の結果を控え、After で同じだけ通ることを確認する」と
 * 要求するが、その控えは**各セッションの頭の中にしか無かった**（Herdr 撤去では
 * 1432 → 1423 を手で数えた）。`regression-guard.mjs` は守りの**存在**を見る道具で、
 * **数が減っていないか**は誰も見ていない。ここがその控え帳になる。
 *
 *   node nimbus/scripts/degrade.mjs record          # いまを測って基準にする
 *   node nimbus/scripts/degrade.mjs check           # 基準と突き合わせ。減りがあれば exit 1
 *   node nimbus/scripts/degrade.mjs check --full    # GUI 全件の通過数まで見る（総合試験の締め）
 *   node nimbus/scripts/degrade.mjs check --json    # 機械が読む形式
 *
 * ## 意図した削減の通しかた
 *
 * 消す判断をしたとき（例: Herdr 撤去）は `check` が一度赤を出す。それでよい —
 * 変更と**同じコミットで** `record` し直せば、基準の diff に削減が残る。
 * tasks.md の「消す理由を 1 行残す」と同じ運用が、数字の側にも通る。
 *
 * ## 測るもの
 *
 * ドクターと同じ方針 — **機械が確実に言えることだけを言う**。
 * 「遅くなった」「使いにくくなった」のような判断は扱わない。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BASELINE_PATH = join(ROOT, 'nimbus', 'tests', 'baseline.json');

// ---------------------------------------------------------------- 純粋な部分（テスト対象）

/**
 * `test.sh unit` の集計行を読む。
 * スイートは複数走る（拡張のモジュールテスト＋コア側 sessions）ので、**全部を合算する**。
 */
export function parseUnitSummary(output) {
	let tests = 0;
	let pass = 0;
	let seen = false;
	for (const line of output.split('\n')) {
		const t = /ℹ tests (\d+)/.exec(line);
		const p = /ℹ pass (\d+)/.exec(line);
		if (t) {
			tests += Number(t[1]);
			seen = true;
		}
		if (p) {
			pass += Number(p[1]);
		}
	}
	return seen ? { tests, pass } : undefined;
}

/** GUI ランナーの「N/M 通過」を読む。見つからなければ undefined（失敗を 0 と混同しない） */
export function parseGuiSummary(output) {
	const m = /(\d+)\/(\d+) 通過/.exec(output);
	return m ? { pass: Number(m[1]), cases: Number(m[2]) } : undefined;
}

/** regression-guard の「守りの無いもの N 件」を読む */
export function parseUnguarded(output) {
	const m = /守りの無いもの[^\d]*(\d+) 件/.exec(output);
	return m ? Number(m[1]) : undefined;
}

/**
 * ソースの export 名を拾う。
 * 「共有モジュールの既存の関数シグネチャ・export を変えない（足すのは可）」（CLAUDE.md）の機械化。
 * 名前の消失だけを見る — シグネチャの差分まで見ると偽の指摘が増える（型の書き換えは正当にある）。
 */
export function exportNames(source) {
	const names = new Set();
	for (const m of source.matchAll(
		/^export (?:async )?(?:function|const|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm
	)) {
		names.add(m[1]);
	}
	return [...names].sort();
}

/** 目録どうしの「消えたもの」。増えたものは咎めない（足すのは自由） */
function missing(base, current) {
	const now = new Set(current);
	return (base ?? []).filter((entry) => !now.has(entry));
}

/**
 * 基準と今を突き合わせる。**減りだけを言う**（増えるのは自由）。
 * error = 戻ったか消えた（止める）/ warn = 悪化の気配（参考・止めない）
 */
export function compareBaseline(base, current) {
	const findings = [];
	const error = (message, detail) => findings.push({ level: 'error', message, ...(detail ? { detail } : {}) });
	const warn = (message, detail) => findings.push({ level: 'warn', message, ...(detail ? { detail } : {}) });
	const list = (items) => items.slice(0, 10).join(' / ') + (items.length > 10 ? ` …ほか ${items.length - 10} 件` : '');

	if (base.unit && current.unit) {
		// 「通過」で比べると、通っているテストを消しただけでも減って見える（Herdr 撤去 1432→1423 が実例）。
		// **落ちている数**と**総数**に分ければ、各メッセージが 1 つの事実だけを言う
		const baseFailing = base.unit.tests - base.unit.pass;
		const currentFailing = current.unit.tests - current.unit.pass;
		if (currentFailing > baseFailing) {
			error(
				`落ちるモジュールテストが増えた: ${baseFailing} → ${currentFailing} 件`,
				'まず落ちているものを直す（bash nimbus/scripts/test.sh unit）'
			);
		}
		if (current.unit.tests < base.unit.tests) {
			error(
				`モジュールテストの総数が減った: ${base.unit.tests} → ${current.unit.tests}`,
				'テストが消えている。意図した削除なら、変更と同じコミットで record し直す（diff に残す）'
			);
		}
	}

	const goneCases = missing(base.guiCases, current.guiCases);
	if (goneCases.length > 0) {
		error(`GUI ケースが消えた（${goneCases.length} 件）: ${list(goneCases)}`, '守りが消えると、戻っても気づけない');
	}

	for (const [kind, label] of [
		['commands', 'コマンド'],
		['views', 'ビュー'],
		['settings', '設定']
	]) {
		const gone = missing(base.contributes?.[kind], current.contributes?.[kind]);
		if (gone.length > 0) {
			error(`${label}の入口が消えた（${gone.length} 件）: ${list(gone)}`, '機能の入口が消えると、利用者からは機能ごと消えたに見える');
		}
	}

	for (const [file, names] of Object.entries(base.coreExports ?? {})) {
		const now = current.coreExports?.[file];
		if (!now) {
			error(`core のモジュールが消えた: ${file}`, '共有モジュールは他のセッションの前提。消すなら record を同じコミットで');
			continue;
		}
		const gone = missing(names, now);
		if (gone.length > 0) {
			error(`core/${file} の export が消えた: ${list(gone)}`, 'CLAUDE.md「既存の export を変えない（足すのは可）」');
		}
	}

	const goneSpecs = missing(base.specs, current.specs);
	if (goneSpecs.length > 0) {
		error(`仕様書が消えた（${goneSpecs.length} 件）: ${list(goneSpecs)}`);
	}

	if (base.doctorErrors !== undefined && current.doctorErrors !== undefined && current.doctorErrors > base.doctorErrors) {
		error(`ドクターの要対応が増えた: ${base.doctorErrors} → ${current.doctorErrors}`, 'node nimbus/scripts/doctor.mjs で中身を見る');
	}

	if (base.unguarded !== undefined && current.unguarded !== undefined && current.unguarded > base.unguarded) {
		// 新しい完了の直後は普通に起きるので、止めずに参考として出す（ドクターの warn と同じ扱い）
		warn(`守りの無い完了が増えた: ${base.unguarded} → ${current.unguarded}`, 'node nimbus/scripts/regression-guard.mjs で誰が丸腰かを見る');
	}

	if (base.guiFull && current.guiFull) {
		if (current.guiFull.pass < base.guiFull.pass) {
			error(`GUI 全件の通過が減った: ${base.guiFull.pass} → ${current.guiFull.pass}`);
		}
	}

	return findings;
}

// ---------------------------------------------------------------- 測る部分

function run(command, args, options = {}) {
	return execFileSync(command, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options });
}

/** 落ちても出力は要る（通過数を数えるため）。exit code は握って出力だけ返す */
function runLoose(command, args) {
	try {
		return run(command, args);
	} catch (failure) {
		return `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
	}
}

function collectContributes() {
	const pkg = JSON.parse(readFileSync(join(ROOT, 'extensions', 'nimbus', 'package.json'), 'utf8'));
	const contributes = pkg.contributes ?? {};
	const views = Object.values(contributes.views ?? {})
		.flat()
		.map((view) => view.id);
	return {
		commands: (contributes.commands ?? []).map((entry) => entry.command).sort(),
		views: views.sort(),
		settings: Object.keys(contributes.configuration?.properties ?? {}).sort()
	};
}

function collectCoreExports() {
	const dir = join(ROOT, 'extensions', 'nimbus', 'src', 'core');
	const result = {};
	for (const name of readdirSync(dir).sort()) {
		if (!name.endsWith('.ts')) {
			continue;
		}
		result[name] = exportNames(readFileSync(join(dir, name), 'utf8'));
	}
	return result;
}

function collectGuiCases() {
	const dir = join(ROOT, 'nimbus', 'tests', 'gui', 'cases');
	return readdirSync(dir)
		.filter((name) => name.endsWith('.mjs'))
		.sort();
}

function collectSpecs() {
	const dir = join(ROOT, 'nimbus', 'docs', 'specs');
	return readdirSync(dir)
		.filter((name) => name.endsWith('.md'))
		.sort();
}

/** いまを測る。full=true のときだけ GUI 全件（重い・総合試験用） */
export function measure({ full = false } = {}) {
	console.log('  測っています: モジュールテスト（compile 込み）…');
	const unit = parseUnitSummary(runLoose('bash', [join('nimbus', 'scripts', 'test.sh'), 'unit']));

	console.log('  測っています: ドクター…');
	let doctorErrors;
	try {
		const doctor = JSON.parse(runLoose('node', [join('nimbus', 'scripts', 'doctor.mjs'), '--json']));
		doctorErrors = doctor.summary?.error;
	} catch {
		// 読めなければ比較しない（無いものを 0 と偽らない）
	}

	console.log('  測っています: 守りの無い完了…');
	const unguarded = parseUnguarded(runLoose('node', [join('nimbus', 'scripts', 'regression-guard.mjs')]));

	let guiFull;
	if (full) {
		console.log('  測っています: GUI 全件（総合試験・時間がかかります）…');
		guiFull = parseGuiSummary(runLoose('node', [join('nimbus', 'tests', 'gui', 'run.mjs')]));
	}

	return {
		recordedAt: new Date().toISOString(),
		commit: runLoose('git', ['rev-parse', '--short', 'HEAD']).trim(),
		unit,
		guiCases: collectGuiCases(),
		contributes: collectContributes(),
		coreExports: collectCoreExports(),
		specs: collectSpecs(),
		doctorErrors,
		unguarded,
		...(guiFull ? { guiFull } : {})
	};
}

// ---------------------------------------------------------------- CLI

function record(options) {
	const current = measure(options);
	writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 1)}\n`, 'utf8');
	console.log(`\n基準を書きました: nimbus/tests/baseline.json（${current.commit}）`);
	console.log(
		`  モジュール ${current.unit?.pass ?? '?'}/${current.unit?.tests ?? '?'} · GUI ケース ${current.guiCases.length} 本 · ` +
			`コマンド ${current.contributes.commands.length} · ドクター要対応 ${current.doctorErrors ?? '?'}` +
			(current.guiFull ? ` · GUI 全件 ${current.guiFull.pass}/${current.guiFull.cases}` : '')
	);
	console.log('  この変更はコミットに含めてください（基準の動きが diff に残ります）。');
	return 0;
}

function check(options) {
	if (!existsSync(BASELINE_PATH)) {
		console.error('基準がありません。先に: node nimbus/scripts/degrade.mjs record');
		return 2;
	}
	const base = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
	const current = measure(options);
	const findings = compareBaseline(base, current);

	if (options.json) {
		console.log(JSON.stringify({ base: { commit: base.commit, recordedAt: base.recordedAt }, findings }, null, 2));
		return findings.some((finding) => finding.level === 'error') ? 1 : 0;
	}

	console.log(`\n# デグレチェック（基準: ${base.commit} · ${base.recordedAt?.slice(0, 10)}）\n`);
	console.log(
		`  いま: モジュール ${current.unit?.pass ?? '?'}/${current.unit?.tests ?? '?'} · GUI ケース ${current.guiCases.length} 本 · ` +
			`コマンド ${current.contributes.commands.length} · ドクター要対応 ${current.doctorErrors ?? '?'}` +
			(current.guiFull ? ` · GUI 全件 ${current.guiFull.pass}/${current.guiFull.cases}` : '')
	);
	if (findings.length === 0) {
		console.log('\n  ✔ 減っていません（基準と同じか、増えているだけ）。');
		return 0;
	}
	const errors = findings.filter((finding) => finding.level === 'error');
	const warns = findings.filter((finding) => finding.level === 'warn');
	if (errors.length > 0) {
		console.log(`\n## ✖ 減っています（${errors.length} 件）\n`);
		for (const finding of errors) {
			console.log(`- ${finding.message}`);
			if (finding.detail) {
				console.log(`    ${finding.detail}`);
			}
		}
	}
	if (warns.length > 0) {
		console.log(`\n## △ 参考（止めません・${warns.length} 件）\n`);
		for (const finding of warns) {
			console.log(`- ${finding.message}`);
			if (finding.detail) {
				console.log(`    ${finding.detail}`);
			}
		}
	}
	if (errors.length > 0) {
		console.log('\n  意図した削減なら、変更と同じコミットで record し直してください（diff に残ります）。');
		return 1;
	}
	return 0;
}

function main() {
	const args = process.argv.slice(2);
	const options = { full: args.includes('--full'), json: args.includes('--json') };
	const command = args.find((arg) => !arg.startsWith('--'));
	if (command === 'record') {
		process.exitCode = record(options);
	} else if (command === 'check') {
		process.exitCode = check(options);
	} else {
		console.log('使いかた: node nimbus/scripts/degrade.mjs record | check [--full] [--json]');
		process.exitCode = 2;
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main();
}
