/**
 * ストリーミング入力の待ち行列。
 * ここが詰まる／取りこぼすと、送ったつもりのメッセージが Claude に届かない。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { AsyncMessageQueue } from '../session/AsyncMessageQueue';

test('先に push した分は順番どおりに取り出せる', async () => {
	const queue = new AsyncMessageQueue<number>();
	queue.push(1);
	queue.push(2);
	const iterator = queue[Symbol.asyncIterator]();
	assert.deepStrictEqual(await iterator.next(), { value: 1, done: false });
	assert.deepStrictEqual(await iterator.next(), { value: 2, done: false });
});

test('待っている最中に push されたら、その場で受け取れる', async () => {
	const queue = new AsyncMessageQueue<string>();
	const iterator = queue[Symbol.asyncIterator]();
	const pending = iterator.next();
	queue.push('あとから');
	assert.deepStrictEqual(await pending, { value: 'あとから', done: false });
});

test('close すると待っている側が done で解ける（永久に待たせない）', async () => {
	const queue = new AsyncMessageQueue<string>();
	const iterator = queue[Symbol.asyncIterator]();
	const pending = iterator.next();
	queue.close();
	assert.deepStrictEqual(await pending, { value: undefined, done: true });
});

test('close 済みに push すると失敗する（黙って捨てない）', () => {
	const queue = new AsyncMessageQueue<string>();
	queue.close();
	assert.throws(() => queue.push('x'), /closed/);
});

test('close は何度呼んでもよい', () => {
	const queue = new AsyncMessageQueue<string>();
	queue.close();
	queue.close();
	assert.strictEqual(queue.isClosed, true);
});

test('close 後も、既に積まれている分は取り出せる', async () => {
	const queue = new AsyncMessageQueue<number>();
	queue.push(1);
	queue.close();
	const iterator = queue[Symbol.asyncIterator]();
	assert.deepStrictEqual(await iterator.next(), { value: 1, done: false });
	assert.deepStrictEqual(await iterator.next(), { value: undefined, done: true });
});
