/**
 * コアのパッチを当て直す道具（`nimbus/branding/apply-core-changes.mjs`）の守り。
 *
 * **T-366 の守り。** 実際に起きたのは、T-238 で `paneCompositeBar.ts` のツリーだけを手で直し、
 * script の置換文字列を T-246 当時のまま取り残したこと。素で走らせると
 * 「置換対象が 0 箇所」で throw する状態が、**誰にも気づかれずに残っていた**。
 *
 * **なぜ気づけなかったか** — ファイル書き込みの前に落ちるので**実害が出ない**。
 * 効くのは `sync-upstream.sh` のあと、パッチを当て直すときだけで、そのとき
 * コアの Nimbus ブロックが丸ごと落ちる（CLAUDE.md「回帰の 3 大原因」の 3 つめそのもの）。
 * **1 年に数回しか通らない道は、試験で毎回通す以外に守りようがない。**
 *
 * **正解は base コミットから取る**（Codex の指摘 2026-08-31）。
 * 最初はツリーを逆適用して原文を作ろうとしたが、それだと **`from` と `to` が揃って古いとき、
 * 古いものを正解にしてしまう**（試験が同じ誤りから正解を生成する）。
 * 台帳の `<!-- nimbus:base ... -->` が指すコミットを独立した入力にすれば、その穴が塞がる。
 *
 * データ駆動にしてあるので、**置換を足したら自動的に検査対象に入る**（試験側に足す必要がない）。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replacements } from '../../branding/apply-core-changes.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (file) => readFileSync(join(ROOT, file), 'utf8');

/** 台帳が指す upstream のコミット。追従のたびに `sync-upstream.sh` が書き換える */
function baseCommit() {
	const match = /<!-- nimbus:base ([0-9a-f]{40}) -->/.exec(read('nimbus/docs/core-changes.md'));
	assert.ok(match, '台帳に `<!-- nimbus:base <sha> -->` が無い（正解の出どころが取れない）');
	return match[1];
}

/** base コミットのファイル。**無ければ skip せず赤にする** — 正解が無いまま緑にしない */
function baseFile(sha, file) {
	try {
		return execFileSync('git', ['show', `${sha}:${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	} catch (error) {
		assert.fail(
			`base コミット ${sha.slice(0, 8)} の ${file} を取り出せない。` +
				`fixture が無いので**確かめられていない** — skip せず赤にする（${error instanceof Error ? error.message.split('\n')[0] : error}）`
		);
	}
}

/** ファイルごとに、宣言順のままエントリをまとめる（順番に意味がある — 後のが前の結果に乗る） */
function byFile(entries = replacements) {
	const map = new Map();
	for (const [file, from, to] of entries) {
		if (!map.has(file)) {
			map.set(file, []);
		}
		map.get(file).push({ from, to });
	}
	return map;
}

/** script と同じ手順で当てる。数が 1 でなければ理由つきで投げる */
function applyAll(text, entries, file) {
	let out = text;
	for (const { from, to } of entries) {
		if (out.includes(to)) {
			continue; // 適用済み（script と同じ判断）
		}
		const hits = out.split(from).length - 1;
		assert.equal(
			hits,
			1,
			`${file}: 「置換前」が ${hits} 箇所（1 箇所であるべき）— ${from.split('\n')[0].trim().slice(0, 90)}`
		);
		out = out.replace(from, () => to);
	}
	return out;
}

test('base の原文にパッチを当てると、いまのツリーと 1 バイトも違わない（T-366）', () => {
	const sha = baseCommit();
	const wrong = [];
	for (const [file, entries] of byFile()) {
		const built = applyAll(baseFile(sha, file), entries, file);
		const current = read(file);
		if (built !== current) {
			/*
			 * ここが落ちるのは「ツリーだけ手で直して script を置き去りにした」とき。
			 * T-366（T-238 が `workbench.panel.chat` を足したのに script が T-246 のまま）が
			 * まさにこれ。**どこで食い違ったか**まで出さないと直せない
			 */
			const a = built.split('\n');
			const b = current.split('\n');
			let i = 0;
			while (i < a.length && i < b.length && a[i] === b[i]) {
				i++;
			}
			wrong.push(
				`${file}: ${i + 1} 行目から食い違う\n` +
					`      script が作る: ${JSON.stringify((a[i] ?? '（終端）').slice(0, 90))}\n` +
					`      いまのツリー : ${JSON.stringify((b[i] ?? '（終端）').slice(0, 90))}`
			);
		}
	}
	assert.deepStrictEqual(
		wrong,
		[],
		`script が作るツリーと、いまのツリーが違う。upstream 追従でこの差が消える:\n  ${wrong.join('\n  ')}`
	);
});

test('適用済みのツリーへもう一度当てても、1 バイトも変わらない（冪等・T-366）', () => {
	const wrong = [];
	for (const [file, entries] of byFile()) {
		const current = read(file);
		if (applyAll(current, entries, file) !== current) {
			wrong.push(file);
		}
	}
	assert.deepStrictEqual(wrong, [], `2 回目の適用でツリーが変わる（`.trim() + `${wrong.join(', ')}）`);
});

test('「置換前」が 0 箇所でも 2 箇所でも失敗する（黙って通さない・T-366）', () => {
	const sha = baseCommit();
	const [file, from, to] = replacements[0];
	const original = baseFile(sha, file);

	// 0 箇所 — upstream の文言が変わった場合
	assert.throws(
		() => applyAll(original.replace(from, () => '/* upstream が書き換えた */'), [{ from, to }], file),
		/置換前.*0 箇所/,
		'アンカーが消えているのに通ってしまう'
	);

	// 2 箇所 — upstream のリファクタで複製された場合。**1 つだけ直して成功にしない**
	assert.throws(
		() => applyAll(original.replace(from, () => `${from}\n${from}`), [{ from, to }], file),
		/置換前.*2 箇所/,
		'アンカーが 2 つあるのに片方だけ直して通ってしまう'
	);
});

test('途中で失敗しても、どのファイルも書き換えない（T-366）', () => {
	/*
	 * script は**最後にまとめて書く**（`for (const [file, text] of byFile) writeFileSync(...)`）。
	 * 32 件目で落ちても 1〜31 件目が書かれていないのは、この順序が保っている性質。
	 * ループの中で書くように直されると、失敗したツリーが半端に残る。
	 */
	const source = read('nimbus/branding/apply-core-changes.mjs');
	const writeAt = source.indexOf('writeFileSync(join(process.cwd(), file), text)');
	const throwAt = source.indexOf('throw new Error(`${file}: 置換対象が');
	assert.ok(writeAt > 0 && throwAt > 0, 'script の書き込みと throw が見つからない（作りが変わった）');
	assert.ok(
		throwAt < writeAt,
		'書き込みが throw より先にある。途中で失敗したときにツリーが半端に残る'
	);
});

test('置換対象のファイルが base に実在する（改名・消失を黙って見逃さない・T-366）', () => {
	const sha = baseCommit();
	const missing = [];
	for (const file of byFile().keys()) {
		try {
			execFileSync('git', ['cat-file', '-e', `${sha}:${file}`], { cwd: ROOT, stdio: 'ignore' });
		} catch {
			missing.push(file);
		}
	}
	assert.deepStrictEqual(
		missing,
		[],
		`base に無いファイルを置換対象にしている（upstream で改名・削除された）:\n  ${missing.join('\n  ')}`
	);
});
