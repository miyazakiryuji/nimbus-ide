/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** 守っている修正（T-274）: T-084 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { missingExecutableGuidance, remoteLabel, remoteReadiness } from '../core/remoteGuidance';

describe('remoteGuidance', () => {
	test('繋ぎ先の呼びかた。知らないものはそのまま出す', () => {
		assert.deepStrictEqual(
			[undefined, 'ssh-remote', 'dev-container', 'attached-container', 'wsl', 'codespaces', 'something-new'].map(remoteLabel),
			[undefined, 'SSH 接続先', 'コンテナの中', 'コンテナの中', 'WSL の中', 'Codespaces', 'something-new']
		);
	});

	test('手元のときは今までどおりの案内で、モーダルにしない', () => {
		assert.deepStrictEqual(missingExecutableGuidance(undefined), {
			message: 'Nimbus: Claude Code が見つかりません。インストールするか、設定 nimbus.claudeCodeExecutable にパスを指定してください。'
		});
	});

	test('リモートのときは「繋いだ先に入れる」と言い、手元では効かないと明記する', () => {
		const guidance = missingExecutableGuidance('ssh-remote');
		assert.deepStrictEqual(
			{
				saysWhere: guidance.message.includes('SSH 接続先'),
				saysRemoteSide: guidance.message.includes('繋いだ先'),
				saysLocalUseless: guidance.detail?.includes('手元（この PC）に入っていても使われません') ?? false,
				saysAuth: guidance.detail?.includes('~/.claude') ?? false
			},
			{ saysWhere: true, saysRemoteSide: true, saysLocalUseless: true, saysAuth: true }
		);
	});

	test('知らない繋ぎ先でも案内は成り立つ', () => {
		const guidance = missingExecutableGuidance('my-remote');
		assert.strictEqual(guidance.message.includes('my-remote'), true);
		assert.notStrictEqual(guidance.detail, undefined);
	});

	test('手元では前置きを何も出さない', () => {
		assert.deepStrictEqual(remoteReadiness(undefined), []);
	});

	test('リモートでは、実行ファイル・認証・ターミナルがどちら側かを言う', () => {
		assert.deepStrictEqual(remoteReadiness('dev-container'), [
			'Nimbus の拡張はコンテナの中で動いています。',
			'Claude Code の実行ファイルと認証（~/.claude）は、コンテナの中のものが使われます。',
			'ターミナル・テスト・git もコンテナの中で走ります。'
		]);
	});
});
