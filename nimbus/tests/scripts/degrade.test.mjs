/**
 * デグレチェック（`nimbus/scripts/degrade.mjs`・T-335）の突き合わせの検査。
 *
 * ここが間違えると 2 通りに困る — **減っているのに緑**（控え帳の意味が無い）か、
 * **増えただけなのに赤**（偽の指摘は、直っているものを直させる・ドクターの教訓）。
 * 両方向を必ず対にして押さえる。
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
	compareBaseline,
	exportNames,
	parseGuiSummary,
	parseUnguarded,
	parseUnitSummary
} from '../../scripts/degrade.mjs';

/** 基準の見本。1 か所だけ変えて比較する */
function base(over = {}) {
	return {
		unit: { tests: 100, pass: 100 },
		guiCases: ['01-a.mjs', '02-b.mjs'],
		contributes: { commands: ['nimbus.one'], views: ['nimbus.cockpit'], settings: ['nimbus.x'] },
		coreExports: { 'activity.ts': ['buildActivity'] },
		specs: ['a.md'],
		doctorErrors: 0,
		unguarded: 5,
		...over
	};
}

function errors(findings) {
	return findings.filter((finding) => finding.level === 'error').map((finding) => finding.message);
}

test('同じなら黙る。増えるのは自由（テスト・ケース・入口・export・仕様）', () => {
	assert.deepEqual(compareBaseline(base(), base()), []);
	const grown = base({
		unit: { tests: 110, pass: 110 },
		guiCases: ['01-a.mjs', '02-b.mjs', '03-c.mjs'],
		contributes: { commands: ['nimbus.one', 'nimbus.two'], views: ['nimbus.cockpit'], settings: ['nimbus.x'] },
		coreExports: { 'activity.ts': ['buildActivity', 'newHelper'], 'fresh.ts': ['brandNew'] },
		specs: ['a.md', 'b.md'],
		doctorErrors: 0,
		unguarded: 3
	});
	assert.deepEqual(compareBaseline(base(), grown), []);
});

test('落ちが増えたら止める。総数が減っても止める — 各メッセージは 1 つの事実だけを言う', () => {
	// 落ちが増えた（総数は同じ）→ 「落ちる」だけが出る
	assert.deepEqual(errors(compareBaseline(base(), base({ unit: { tests: 100, pass: 98 } }))), [
		'落ちるモジュールテストが増えた: 0 → 2 件'
	]);
	// 通っているテストを消した（Herdr 撤去の形）→ 「総数」だけが出る
	assert.deepEqual(errors(compareBaseline(base(), base({ unit: { tests: 91, pass: 91 } }))), [
		'モジュールテストの総数が減った: 100 → 91'
	]);
	// 両方起きたら両方言う
	assert.equal(errors(compareBaseline(base(), base({ unit: { tests: 95, pass: 90 } }))).length, 2);
});

test('GUI ケースが消えたら止める（守りが消えると、戻っても気づけない）', () => {
	const found = errors(compareBaseline(base(), base({ guiCases: ['01-a.mjs'] })));
	assert.match(found[0], /GUI ケースが消えた（1 件）: 02-b\.mjs/);
});

test('入口（コマンド・ビュー・設定）が消えたら止める', () => {
	const found = errors(
		compareBaseline(
			base(),
			base({ contributes: { commands: [], views: ['nimbus.cockpit'], settings: ['nimbus.x'] } })
		)
	);
	assert.match(found[0], /コマンドの入口が消えた（1 件）: nimbus\.one/);
});

test('core の export が消えたら止める。モジュールごと消えても止める', () => {
	assert.match(
		errors(compareBaseline(base(), base({ coreExports: { 'activity.ts': [] } })))[0],
		/core\/activity\.ts の export が消えた: buildActivity/
	);
	assert.match(
		errors(compareBaseline(base(), base({ coreExports: {} })))[0],
		/core のモジュールが消えた: activity\.ts/
	);
});

test('仕様書が消えたら止める', () => {
	assert.match(errors(compareBaseline(base(), base({ specs: [] })))[0], /仕様書が消えた/);
});

test('ドクターの要対応は、増えたら止める・減ったら黙る', () => {
	assert.match(errors(compareBaseline(base(), base({ doctorErrors: 2 })))[0], /要対応が増えた: 0 → 2/);
	assert.deepEqual(compareBaseline(base({ doctorErrors: 3 }), base({ doctorErrors: 1 })), []);
});

test('守りの無い完了は、増えても止めない（参考として言うだけ）', () => {
	const findings = compareBaseline(base(), base({ unguarded: 7 }));
	assert.deepEqual(errors(findings), []);
	assert.match(findings[0].message, /守りの無い完了が増えた: 5 → 7/);
	assert.equal(findings[0].level, 'warn');
});

test('GUI 全件は、両方に記録があるときだけ比べる', () => {
	// 基準に無い（--full で録っていない）なら、今回だけ測れていても言わない
	assert.deepEqual(compareBaseline(base(), base({ guiFull: { cases: 50, pass: 50 } })), []);
	const found = errors(
		compareBaseline(base({ guiFull: { cases: 50, pass: 50 } }), base({ guiFull: { cases: 50, pass: 48 } }))
	);
	assert.match(found[0], /GUI 全件の通過が減った: 50 → 48/);
});

test('測れなかったもの（undefined）は比較しない — 無いものを 0 と偽らない', () => {
	assert.deepEqual(compareBaseline(base(), base({ unit: undefined, doctorErrors: undefined, unguarded: undefined })), []);
});

test('集計行の読み取り: スイートが複数でも合算し、無ければ undefined', () => {
	const output = ['ℹ tests 1423', 'ℹ pass 1423', 'ほか', 'ℹ tests 14', 'ℹ pass 14'].join('\n');
	assert.deepEqual(parseUnitSummary(output), { tests: 1437, pass: 1437 });
	assert.equal(parseUnitSummary('何も出ていない'), undefined);

	assert.deepEqual(parseGuiSummary('…\n54/54 通過\n'), { pass: 54, cases: 54 });
	assert.equal(parseGuiSummary('落ちて何も出ない'), undefined);

	assert.equal(parseUnguarded('完了 300 件 / 守りのあるもの 250 件 / **守りの無いもの 50 件**'), 50);
});

test('export 名の拾いかた: 関数・型・クラス・enum を名前で拾い、重複しない', () => {
	const source = [
		"export function buildActivity(a) {}",
		"export async function runIt() {}",
		"export const LIMIT = 3",
		"export class Store {}",
		"export interface Shape { x: number }",
		"export type Kind = 'a'",
		"export enum Mode { A }",
		"const secret = 1",
		"export function buildActivity(b) {}" // 重複
	].join('\n');
	assert.deepEqual(exportNames(source), ['Kind', 'LIMIT', 'Mode', 'Shape', 'Store', 'buildActivity', 'runIt']);
});
