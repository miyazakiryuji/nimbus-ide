/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** 守っている修正（T-274）: T-092 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	clampContext,
	formatContext,
	MAX_CONTEXT_BYTES,
	MAX_PER_EXTENSION,
	validate,
	type RegisteredContribution
} from '../core/pluginApi';

const contribution = { kind: 'context' as const, id: 'branch', label: 'ブランチの決まり' };

function registered(extensionId: string, id: string): RegisteredContribution {
	return { ...contribution, id, extensionId, qualifiedId: `${extensionId}/${id}` };
}

describe('pluginApi', () => {
	test('拡張 ID の形が違えば断り、直しかたを言う', () => {
		assert.deepStrictEqual(validate('nopublisher', contribution, []), {
			ok: false,
			reason: '拡張 ID の形が違います（publisher.name の形で渡してください）: nopublisher'
		});
	});

	test('通ると、出どころつきの名前が付く', () => {
		assert.deepStrictEqual(validate('acme.tools', contribution, []), {
			ok: true,
			registered: { ...contribution, extensionId: 'acme.tools', qualifiedId: 'acme.tools/branch' }
		});
	});

	test('本体と紛れる id と、使えない文字を断る', () => {
		assert.deepStrictEqual(validate('acme.tools', { ...contribution, id: 'nimbusThing' }, []), {
			ok: false,
			reason: 'id を nimbus で始めることはできません（本体のものと紛れます）'
		});
		assert.deepStrictEqual(validate('acme.tools', { ...contribution, id: 'a/b' }, []), {
			ok: false,
			reason: 'id は英数字と - _ だけにしてください: a/b'
		});
	});

	test('空と長すぎる label を断る', () => {
		assert.deepStrictEqual(validate('acme.tools', { ...contribution, label: '   ' }, []), { ok: false, reason: 'label が空です' });
		assert.deepStrictEqual(validate('acme.tools', { ...contribution, label: 'あ'.repeat(61) }, []), {
			ok: false,
			reason: 'label が長すぎます（60 文字まで）'
		});
	});

	test('label の前後の空白は落として登録する', () => {
		const result = validate('acme.tools', { ...contribution, label: '  名前  ' }, []);
		assert.strictEqual(result.ok && result.registered.label, '名前');
	});

	test('同じ id は 2 回登録できない。別の拡張なら同じ id でも通る', () => {
		const existing = [registered('acme.tools', 'branch')];
		assert.deepStrictEqual(validate('acme.tools', contribution, existing), {
			ok: false,
			reason: '同じ id が既に登録されています: acme.tools/branch'
		});
		assert.strictEqual(validate('other.ext', contribution, existing).ok, true);
	});

	test('1 拡張あたりの上限を超えたら断る（一覧が使えなくなるため）', () => {
		const many = Array.from({ length: MAX_PER_EXTENSION }, (_, i) => registered('acme.tools', `item${i}`));
		assert.deepStrictEqual(validate('acme.tools', contribution, many), {
			ok: false,
			reason: `1 つの拡張が足せるのは ${MAX_PER_EXTENSION} 件までです`
		});
		// 他の拡張のぶんは数えない
		assert.strictEqual(validate('other.ext', contribution, many).ok, true);
	});

	test('文脈は出どころを添えて並べ、空のものは落とす', () => {
		assert.strictEqual(
			formatContext([
				{ qualifiedId: 'acme.tools/branch', label: 'ブランチの決まり', text: 'main へ直接 push しない' },
				{ qualifiedId: 'acme.tools/empty', label: '空', text: '   ' }
			]),
			'## 拡張が足した前提\n\n### ブランチの決まり（acme.tools/branch）\n\nmain へ直接 push しない'
		);
		assert.strictEqual(formatContext([]), '');
	});

	test('長すぎる文脈は切り、切ったことを本文に書く', () => {
		const long = 'あ'.repeat(MAX_CONTEXT_BYTES);
		const clamped = clampContext(long);
		assert.deepStrictEqual(
			{
				shorter: clamped.length < long.length,
				withinLimit: Buffer.byteLength(clamped, 'utf8') <= MAX_CONTEXT_BYTES,
				saysSo: clamped.includes('長いので')
			},
			{ shorter: true, withinLimit: true, saysSo: true }
		);
		// 収まるものはそのまま
		assert.strictEqual(clampContext('短い'), '短い');
	});
});
