/**
 * デバッガの状態の見せ方。
 *
 * 渡すのは「止まっている場所」と「そこで見えている値」の 2 つだけ。
 * 巨大な値が 1 つあるだけで文脈が飛ぶので、切り方をここで固める。
 *
 * 守っている修正（T-274）: T-104
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { renderScopes, renderStack, truncateValue, type ScopeLike } from '../core/debugState';

test('コールスタックは止まっている場所から順に番号を振る', () => {
	assert.strictEqual(
		renderStack(
			[
				{ name: 'handleSubmit', file: '/repo/src/a.ts', line: 42 },
				{ name: 'onClick', file: '/repo/src/b.ts', line: 7 },
				{ name: '(anonymous)' }
			],
			(file) => file.replace('/repo/', '')
		),
		['#0 handleSubmit  src/a.ts:42', '#1 onClick  src/b.ts:7', '#2 (anonymous)'].join('\n')
	);
});

test('スタックが空でも黙って空文字を返さない', () => {
	assert.strictEqual(renderStack([], (file) => file), '（コールスタックを取得できませんでした）');
});

test('値は 1 行に均して切る（改行つきのオブジェクトで文脈を溶かさない）', () => {
	assert.strictEqual(truncateValue('{\n  a: 1\n}'), '{   a: 1 }');
	assert.strictEqual(truncateValue('x'.repeat(20), 5), 'xxxxx…');
});

const scopes: ScopeLike[] = [
	{
		name: 'Local',
		variables: [
			{ name: 'user', value: 'null', type: 'User | null' },
			{ name: 'count', value: '3' }
		]
	},
	{ name: 'Registers', variables: [] }
];

test('スコープごとに変数を出し、空のスコープは出さない', () => {
	assert.strictEqual(renderScopes(scopes), ['Local', '  user: User | null = null', '  count = 3'].join('\n'));
	assert.strictEqual(renderScopes([{ name: 'Local', variables: [] }]), '（この位置に見える変数はありません）');
});
