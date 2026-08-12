/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	applyToAlwaysAllow,
	applyToAudit,
	applyToProfile,
	applyToProtectedPaths,
	describeManagedPolicy,
	hasManagedPolicy,
	type ManagedPolicy
} from '../core/managedPolicy';
import { BUILTIN_PROFILES } from '../core/policyProfiles';

const dev = BUILTIN_PROFILES.find((p) => p.name === '開発')!;
const prod = BUILTIN_PROFILES.find((p) => p.name === '本番に触る')!;

describe('managedPolicy', () => {
	test('管理設定が無ければ何も変えない', () => {
		assert.strictEqual(hasManagedPolicy(undefined), false);
		assert.strictEqual(hasManagedPolicy({}), false);
		assert.deepStrictEqual(applyToProfile(undefined, BUILTIN_PROFILES, dev), { value: dev, overridden: false, reason: undefined });
		assert.deepStrictEqual(applyToAlwaysAllow(undefined, ['Read']), { value: ['Read'], overridden: false });
		assert.deepStrictEqual(applyToAudit(undefined, false), { value: false, overridden: false });
		assert.deepStrictEqual(describeManagedPolicy(undefined), []);
	});

	test('使えないプロファイルは一覧の先頭へ落とし、理由を言う', () => {
		const policy: ManagedPolicy = { allowedProfiles: ['本番に触る'] };
		const result = applyToProfile(policy, BUILTIN_PROFILES, dev);
		assert.deepStrictEqual(
			{ name: result.value.name, overridden: result.overridden, reason: result.reason },
			{ name: '本番に触る', overridden: true, reason: '「開発」は組織の設定で使えません。「本番に触る」にしました' }
		);
	});

	test('許されているプロファイルはそのまま通す', () => {
		const policy: ManagedPolicy = { allowedProfiles: ['開発', '本番に触る'] };
		assert.deepStrictEqual(applyToProfile(policy, BUILTIN_PROFILES, prod).overridden, false);
	});

	test('秘匿ファイルの遮断は、プロファイル側が偽でも真にする', () => {
		const loose = { ...dev, blockProtectedReads: false };
		const result = applyToProfile({ enforceBlockProtectedReads: true }, BUILTIN_PROFILES, loose);
		assert.deepStrictEqual(
			{ blocked: result.value.blockProtectedReads, reason: result.reason },
			{ blocked: true, reason: '秘匿ファイルの遮断は組織の設定で外せません' }
		);
	});

	test('自動許可を禁じると全部落ちる。もともと空なら「変えた」とは言わない', () => {
		assert.deepStrictEqual(applyToAlwaysAllow({ forbidAlwaysAllow: true }, ['Read', 'Bash(npm test)']), {
			value: [],
			overridden: true,
			reason: '自動許可は組織の設定で使えません（2 件を無視しました）'
		});
		assert.deepStrictEqual(applyToAlwaysAllow({ forbidAlwaysAllow: true }, []), { value: [], overridden: false });
	});

	test('認めた自動許可だけを残す（狭める方向は触らない）', () => {
		const policy: ManagedPolicy = { allowedAlwaysAllow: ['Read', 'Glob'] };
		assert.deepStrictEqual(applyToAlwaysAllow(policy, ['Read', 'Bash(rm)']), {
			value: ['Read'],
			overridden: true,
			reason: '組織が認めていない自動許可を外しました: Bash(rm)'
		});
		// 利用者が減らすぶんには何も言わない
		assert.deepStrictEqual(applyToAlwaysAllow(policy, ['Read']), { value: ['Read'], overridden: false });
	});

	test('必ず遮断するパスは足され、否定で打ち消してあっても外される', () => {
		const policy: ManagedPolicy = { requiredProtectedPaths: ['**/.env'] };
		assert.deepStrictEqual(applyToProtectedPaths(policy, ['*.pem']), {
			value: ['*.pem', '**/.env'],
			overridden: true,
			reason: '組織が指定した遮断パスを足しました: **/.env'
		});
		assert.deepStrictEqual(applyToProtectedPaths(policy, ['!**/.env']), {
			value: ['**/.env'],
			overridden: true,
			reason: '組織が指定した遮断パスを足しました（打ち消しも外しました）: **/.env'
		});
		// 既に入っていれば何も言わない
		assert.deepStrictEqual(applyToProtectedPaths(policy, ['**/.env']), { value: ['**/.env'], overridden: false });
	});

	test('監査ログは止めさせない', () => {
		assert.deepStrictEqual(applyToAudit({ enforceAudit: true }, false), {
			value: true,
			overridden: true,
			reason: '監査ログは組織の設定で止められません'
		});
		assert.deepStrictEqual(applyToAudit({ enforceAudit: true }, true), { value: true, overridden: false });
	});

	test('効いている制限を、利用者に読める形で全部出す', () => {
		assert.deepStrictEqual(
			describeManagedPolicy({
				allowedProfiles: ['本番に触る'],
				enforceBlockProtectedReads: true,
				forbidAlwaysAllow: true,
				enforceAudit: true,
				requiredProtectedPaths: ['**/.env'],
				contact: 'infra@example.invalid'
			}),
			[
				'使えるポリシー: 本番に触る',
				'秘匿ファイルの遮断は外せません',
				'自動許可は使えません',
				'監査ログは止められません',
				'必ず遮断するパス: **/.env',
				'問い合わせ先: infra@example.invalid'
			]
		);
	});
});
