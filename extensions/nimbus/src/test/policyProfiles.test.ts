/**
 * 承認ポリシーのプロファイルとサンドボックス（T-162 / T-163）の単体テスト。
 *
 * **広げる方向の切り替えを見落とさない**ことが要。狭めるのは黙って通してよいが、
 * 広げるときに確認が出ないと、気づかないうちに緩い状態で走り続ける。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	BUILTIN_PROFILES,
	describeProfile,
	findProfile,
	isWidening,
	toSdkSandbox,
	type PolicyProfile
} from '../core/policyProfiles';

const byName = (name: string): PolicyProfile => findProfile(BUILTIN_PROFILES, name);

test('出荷時に「本番に触る」と「隔離」が入っている（危ないと分かってからでは遅い）', () => {
	assert.deepStrictEqual(
		BUILTIN_PROFILES.map((profile) => profile.name),
		['開発', '調べるだけ', '本番に触る', '隔離（ネットワーク遮断）']
	);
	assert.strictEqual(byName('本番に触る').autoApproveReadOnly, false);
	assert.strictEqual(byName('調べるだけ').permissionMode, 'plan');
	// どのプロファイルでも秘匿ファイルの遮断は切らない
	assert.ok(BUILTIN_PROFILES.every((profile) => profile.blockProtectedReads));
});

test('知らない名前は「開発」に倒す（未知の値で丸腰にしない）', () => {
	assert.strictEqual(findProfile(BUILTIN_PROFILES, 'そんなものは無い').name, '開発');
	assert.strictEqual(findProfile(BUILTIN_PROFILES, undefined).name, '開発');
});

test('サンドボックスが無効なら、SDK には何も渡さない', () => {
	assert.strictEqual(toSdkSandbox({ enabled: false }), undefined);
	assert.strictEqual(toSdkSandbox({ enabled: false, denyAll: true }), undefined);
});

test('隔離は「許可した先以外を塞ぐ」形で渡す', () => {
	assert.deepStrictEqual(toSdkSandbox(byName('隔離（ネットワーク遮断）').sandbox), {
		enabled: true,
		network: { strictAllowlist: true }
	});
});

test('許可ドメインと書き込み禁止も渡せる', () => {
	assert.deepStrictEqual(
		toSdkSandbox({ enabled: true, allowedDomains: ['example.com'], denyWrite: ['/etc'] }),
		{ enabled: true, network: { allowedDomains: ['example.com'] }, filesystem: { denyWrite: ['/etc'] } }
	);
});

test('広げる方向だけを「広がる」と判定する', () => {
	// すべて確認 → 読み取り自動 は広がる
	assert.ok(isWidening(byName('本番に触る'), byName('開発')));
	// 逆は広がらない
	assert.ok(!isWidening(byName('開発'), byName('本番に触る')));
	// サンドボックスを外すのは広がる
	assert.ok(isWidening(byName('隔離（ネットワーク遮断）'), byName('開発')));
	// 秘匿ファイルの遮断を切るのは広がる
	assert.ok(isWidening(byName('開発'), { ...byName('開発'), blockProtectedReads: false }));
	// bypassPermissions への切り替えは広がる
	assert.ok(isWidening(byName('開発'), { ...byName('開発'), permissionMode: 'bypassPermissions' }));
});

test('同じものへの切り替えは広がらない', () => {
	assert.ok(!isWidening(byName('開発'), byName('開発')));
});

test('説明には、いま何が効いているかが出る', () => {
	assert.strictEqual(describeProfile(byName('開発')), 'default · 読み取りは自動');
	assert.strictEqual(describeProfile(byName('本番に触る')), 'default · すべて確認');
	assert.strictEqual(
		describeProfile(byName('隔離（ネットワーク遮断）')),
		'default · 読み取りは自動 · ネットワーク遮断'
	);
	// 遮断を切っている状態は例外なので、必ず見せる
	assert.ok(describeProfile({ ...byName('開発'), blockProtectedReads: false }).includes('遮断オフ'));
});
