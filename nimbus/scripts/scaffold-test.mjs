/**
 * テストの雛形を作る。
 *
 *   node nimbus/scripts/scaffold-test.mjs                       # テストが無いモジュール全部
 *   node nimbus/scripts/scaffold-test.mjs src/core/skills.ts    # 指定したモジュールだけ
 *
 * **中身は書けない。** 何を確かめるべきかは、そのコードが何のために在るかを読まないと決まらない。
 * ここが作るのは「対象・入口・書く場所」までで、実際の assertion は人（または AI）が
 * `write-tests` スキルに従って埋める。埋めるまで `todo` として残り、ドクターが
 * 「雛形のまま」と指摘し続ける。
 *
 * 既にあるテストは上書きしない。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT_SRC = join(ROOT, 'extensions', 'nimbus', 'src');
const TEST_DIR = join(EXT_SRC, 'test');

/** ドクターに「テストが無いモジュール」を聞く（判定を二重に持たない） */
function modulesWithoutTests() {
	let raw;
	try {
		raw = execFileSync(process.execPath, [join(ROOT, 'nimbus', 'scripts', 'doctor.mjs'), 'coverage', '--json'], {
			cwd: ROOT,
			encoding: 'utf8',
			env: { ...process.env, NODE_OPTIONS: '' }
		});
	} catch (error) {
		// ドクターは指摘があると終了コード 1 を返す。指摘こそが欲しい情報なので、出力を使う
		raw = error.stdout;
		if (!raw) {
			throw error;
		}
	}
	const { findings } = JSON.parse(raw);
	return findings
		.filter((f) => f.level === 'error' && f.message.startsWith('テストが無い'))
		.map((f) => join(ROOT, f.detail));
}

/** export されている実行時シンボルを拾う（型は対象外） */
function runtimeExports(source) {
	const names = [];
	for (const match of source.matchAll(/^export\s+(?:async\s+)?(?:function|const|class|enum)\s+([A-Za-z0-9_]+)/gm)) {
		names.push(match[1]);
	}
	return [...new Set(names)];
}

/** ファイル冒頭の JSDoc から、そのモジュールが何のために在るのかを 1 行拾う */
function purposeOf(source) {
	const doc = /^\/\*\*\s*\n\s*\*\s*(.+?)\s*$/m.exec(source);
	return doc ? doc[1] : '';
}

function scaffold(modulePath) {
	const source = readFileSync(modulePath, 'utf8');
	const names = runtimeExports(source);
	if (names.length === 0) {
		return { skipped: '実行時の export が無い' };
	}
	const name = basename(modulePath).replace(/\.ts$/, '');
	const testPath = join(TEST_DIR, `${name}.test.ts`);
	if (existsSync(testPath)) {
		return { skipped: `既にある: ${relative(ROOT, testPath)}` };
	}
	const importPath = `../${relative(EXT_SRC, modulePath).replace(/\.ts$/, '').split('\\').join('/')}`;
	const purpose = purposeOf(source);

	const body = `/**
 * ${name} のテスト。${purpose ? `\n * 対象: ${purpose}` : ''}
 *
 * **雛形です。** 下の todo を、実際に確かめたい振る舞いに置き換えてください
 * （書きかたは \`.agents/skills/write-tests\`）。
 * 埋めるまでドクターが「テストが雛形のまま」と言い続けます。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { ${names.join(', ')} } from '${importPath}';

// 使っていない import で落ちないようにするための参照
void [${names.join(', ')}];

${names
	.map(
		(symbol) => `test('${symbol}: 何を保証したいのかを日本語で書く', { todo: '振る舞いを書く' }, () => {
	assert.ok(${symbol});
});`
	)
	.join('\n\n')}
`;
	mkdirSync(TEST_DIR, { recursive: true });
	writeFileSync(testPath, body);
	return { created: relative(ROOT, testPath), symbols: names.length };
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const targets = args.length > 0 ? args.map((a) => resolve(ROOT, a)) : modulesWithoutTests();

if (targets.length === 0) {
	console.log('テストが無いモジュールはありません');
	process.exit(0);
}

let created = 0;
for (const target of targets) {
	if (!existsSync(target)) {
		console.log(`  ? ${relative(ROOT, target)} — ファイルが無い`);
		continue;
	}
	const result = scaffold(target);
	if (result.created) {
		created++;
		console.log(`  + ${result.created}（export ${result.symbols} 件）`);
	} else {
		console.log(`  - ${relative(ROOT, target)} — ${result.skipped}`);
	}
}
console.log(`\n${created} 件の雛形を作りました。中身を書いてから \`bash nimbus/scripts/test.sh unit\` を通してください。`);
