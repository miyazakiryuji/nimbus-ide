/**
 * セッションの健康診断（tasks.md T-303）。
 *
 *   node nimbus/scripts/session-health.mjs            # 人が読む形式
 *   node nimbus/scripts/session-health.mjs --json     # 機械が読む形式
 *   node nimbus/scripts/session-health.mjs --dir <台帳のパス>
 *   node nimbus/scripts/session-health.mjs --forget   # 忘れてよいものだけ消す
 *
 * 台帳（`globalStorage/idris.nimbus/sessions/`）には 1 セッション 1 ファイルで記録が残る。
 * 持ち主は心拍で決まるので、ウィンドウが落ちると**持ち主のいない記録がそのまま残る**。
 *
 * アプリ側の `sweep()` は「持ち主がいないまま 7 日たったもの」しか落とさず、しかも
 * **Nimbus が動いているときにしか走らない**。横断で数える手段が他に無いので、ここに置く。
 *
 * 方針はドクター（`doctor.mjs`）と同じ ── **機械が確実に言えることだけを言う**。
 * 判定は `extensions/nimbus/src/core/sessionHealth.ts` を読む（ここで線を引き直さない）。
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'extensions', 'nimbus', 'out', 'core', 'sessionHealth.js');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};

/** 拡張の識別子。台帳はこの名前の下に置かれる */
const EXTENSION_ID = 'idris.nimbus';

/** product.json の名前から、アプリのデータ置き場を組み立てる（名前を変えても追随する） */
function appFolder() {
	try {
		const product = JSON.parse(readFileSync(join(ROOT, 'product.json'), 'utf8'));
		return product.nameLong ?? product.nameShort ?? 'Nimbus';
	} catch {
		return 'Nimbus';
	}
}

/** OS ごとの置き場所。見つからなければ空を返す（当てずっぽうで作らない） */
function ledgerDirs() {
	const explicit = value('dir');
	if (explicit) {
		return [explicit];
	}
	const name = appFolder();
	const home = homedir();
	const bases = {
		darwin: [join(home, 'Library', 'Application Support', name)],
		win32: [join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), name)],
		linux: [join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), name)]
	};
	return (bases[platform()] ?? bases.linux)
		.map((base) => join(base, 'User', 'globalStorage', EXTENSION_ID, 'sessions'))
		.filter((dir) => existsSync(dir));
}

function readRecords(dir) {
	const records = [];
	const broken = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.json')) {
			continue;
		}
		try {
			const record = JSON.parse(readFileSync(join(dir, name), 'utf8'));
			// 台帳として読めない形は、数に混ぜず別に出す（黙って捨てない）
			if (record && typeof record.sessionId === 'string' && record.owner) {
				records.push(record);
			} else {
				broken.push(name);
			}
		} catch {
			broken.push(name);
		}
	}
	return { records, broken };
}

function short(text, limit = 60) {
	const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
	return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

function ago(ms) {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) {
		return `${minutes} 分前`;
	}
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} 時間前` : `${Math.round(hours / 24)} 日前`;
}

async function main() {
	if (!existsSync(OUT)) {
		console.error('先に組み立ててください: cd extensions/nimbus && npm run compile');
		return 2;
	}
	const { classify, inspect, needsAttention, summaryLine } = await import(pathToFileURL(OUT).href);

	const dirs = ledgerDirs();
	if (dirs.length === 0) {
		console.log('台帳が見つかりません（Nimbus をまだ起動していないか、別の場所にあります）。');
		console.log('場所が分かっているなら: --dir <パス>');
		return 0;
	}

	const now = Date.now();
	const report = [];
	for (const dir of dirs) {
		const { records, broken } = readRecords(dir);
		report.push({ dir, broken, records, health: inspect(records, now) });
	}

	if (flag('json')) {
		console.log(JSON.stringify({ now, dirs: report.map((r) => ({ ...r, records: undefined })) }, null, 2));
		return report.some((r) => needsAttention(r.health)) ? 1 : 0;
	}

	let attention = false;
	for (const { dir, broken, records, health } of report) {
		console.log(`\n台帳: ${dir}`);
		console.log(`  ${summaryLine(health)}`);

		if (broken.length > 0) {
			console.log(`  ⚠ 読めない記録 ${broken.length} 件: ${broken.slice(0, 5).join(', ')}`);
		}

		// 持ち主がいないのに終わってもいないもの。**これが残骸**
		if (health.orphaned.length > 0) {
			attention = true;
			console.log(`\n  ✖ 持ち主のいないセッション（${health.orphaned.length} 件）`);
			console.log('    ウィンドウが落ちたあとの記録です。続きから開くか、消してください。');
			for (const record of health.orphaned) {
				console.log(
					`    - ${record.sessionId.slice(0, 8)} ${record.status} · ${short(record.title ?? '（題なし）', 40)}`
				);
				console.log(`      ${record.cwd} · 最終更新 ${ago(now - record.updatedAt)}`);
			}
		}

		if (health.overlaps.length > 0) {
			attention = true;
			console.log(`\n  ⚠ 同じフォルダを 2 つ以上が持っています（${health.overlaps.length} 件）`);
			console.log('    片方の前提が黙って壊れます。worktree を切るか、片方を止めてください。');
			for (const overlap of health.overlaps) {
				console.log(`    - ${overlap.cwd}: ${overlap.sessionIds.map((id) => id.slice(0, 8)).join(', ')}`);
			}
		}

		if (health.forgettable.length > 0) {
			attention = true;
			console.log(`\n  △ 忘れてよい記録（${health.forgettable.length} 件）`);
			console.log('    持ち主がいないまま古くなったものです。--forget で消せます。');
		}

		if (flag('forget')) {
			// **消すのは「忘れてよい」ものだけ。** 走っているもの・持ち主のいないものには触らない
			let removed = 0;
			for (const record of health.forgettable) {
				try {
					rmSync(join(dir, `${record.sessionId}.json`), { force: true });
					removed += 1;
				} catch {
					// 消せなくても実害はない
				}
			}
			console.log(`\n  忘れてよい記録を ${removed} 件消しました（他には触っていません）。`);
		}

		if (!needsAttention(health) && records.length > 0) {
			console.log('  ✔ 残骸はありません。');
		}
	}

	console.log('');
	return attention && !flag('forget') ? 1 : 0;
}

process.exitCode = await main();
