/**
 * 出荷時の既定値のうち、**変わると利用者の体験が変わるもの**を固定する。
 *
 * 既定値は 1 文字の差で振る舞いが変わるのに、コードを読んでも「いま何が既定か」が分からない。
 * 送信のたびに割り込むかどうかは、まさにそれで揉めた（T-268）。ここで板に書いた判断を留める。
 *
 * 読むのは `extensions/nimbus/package.json`。テストはリポジトリの根から走る
 * （`nimbus/scripts/test.sh` が `cd` する）ので、そこからの相対で引く。
 */
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';

function defaults(): Record<string, unknown> {
	const manifest = JSON.parse(
		readFileSync(join(process.cwd(), 'extensions', 'nimbus', 'package.json'), 'utf8')
	);
	const configuration = manifest.contributes.configuration;
	const properties: Record<string, { default?: unknown }> = {};
	for (const section of Array.isArray(configuration) ? configuration : [configuration]) {
		Object.assign(properties, section.properties ?? {});
	}
	const values: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(properties)) {
		values[key] = value.default;
	}
	return values;
}

test('送信前の割り込みは、曖昧さの確認だけ既定 off・資格情報の検出は既定 on（T-268）', () => {
	const values = defaults();
	assert.deepStrictEqual(
		{
			confirmVaguePrompt: values['nimbus.dialogue.confirmVaguePrompt'],
			clarifyVagueJapanese: values['nimbus.clarifyVagueJapanese'],
			scanBeforeSend: values['nimbus.safety.scanBeforeSend']
		},
		{
			// 送るたびにモーダルが割り込むのは煩わしい。判定は残し、既定だけ倒す
			confirmVaguePrompt: false,
			clarifyVagueJapanese: false,
			// 外部へ鍵を送る事故は取り返しがつかず、毎回出るものでもない。ここは倒さない
			scanBeforeSend: true
		}
	);
});

test('Git の同期の既定は、Nimbus の作法（pull --rebase → push）に合わせる（T-306）', () => {
	// **標準の口（Git 拡張の設定）を configurationDefaults で上書きする**。作り直さない。
	// autostash は含めない — 他セッションの未コミット変更に触ることになる
	const manifest = JSON.parse(
		readFileSync(join(process.cwd(), 'extensions', 'nimbus', 'package.json'), 'utf8')
	);
	assert.deepStrictEqual(manifest.contributes.configurationDefaults, {
		'git.postCommitCommand': 'sync',
		'git.rebaseWhenSync': true,
		'git.autofetch': true
	});
});
