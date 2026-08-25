/**
 * タブの読み書き（T-314）の単体テスト。実ファイルで確かめる（台帳のテストと同じ流儀）。
 *
 * 押さえるのは 2 つ — 無い・壊れているときに落ちないこと、
 * 同一プロセス内の連続更新が**互いを上書きしない**こと（読み→書きの割り込み）。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GroupStore } from '../groupStore';
import { addGroup, assignSession } from '../core/sessionGroups';

function dir(): string {
	return mkdtempSync(join(tmpdir(), 'nimbus-groups-'));
}

test('無ければ空。作って保存すれば、開き直しても残る', async () => {
	const where = dir();
	const store = new GroupStore(where);

	assert.deepStrictEqual(await store.load(), { groups: [], members: {} });

	await store.update((file) => assignSession(addGroup(file, 'g1', 'ログイン改修', 100), 's1', 'g1'));

	const reopened = new GroupStore(where);
	const loaded = await reopened.load();
	assert.deepStrictEqual(loaded.groups.map((g) => [g.id, g.name]), [['g1', 'ログイン改修']]);
	assert.deepStrictEqual(loaded.members, { s1: 'g1' });
});

test('壊れた JSON でも落ちず、次の保存で形が直る', async () => {
	const where = dir();
	writeFileSync(join(where, 'groups.json'), '{"groups": [壊れ', 'utf8');
	const store = new GroupStore(where);

	assert.deepStrictEqual(await store.load(), { groups: [], members: {} });

	await store.update((file) => addGroup(file, 'g1', '束', 100));
	const raw = JSON.parse(readFileSync(join(where, 'groups.json'), 'utf8'));
	assert.strictEqual(raw.groups[0].id, 'g1');
});

test('連続の更新が互いを上書きしない（読み→書きの割り込みを許さない）', async () => {
	const store = new GroupStore(dir());

	// await せずに 2 つ投げる。直列化が無いと、後の read が先の write より前に走って片方が消える
	const first = store.update((file) => addGroup(file, 'g1', '一', 100));
	const second = store.update((file) => addGroup(file, 'g2', '二', 200));
	await Promise.all([first, second]);

	const loaded = await store.load();
	assert.deepStrictEqual(loaded.groups.map((g) => g.id).sort(), ['g1', 'g2']);
});

test('変わらない更新は書き込まない', async () => {
	const where = dir();
	const store = new GroupStore(where);
	await store.update((file) => addGroup(file, 'g1', '束', 100));
	const before = readFileSync(join(where, 'groups.json'), 'utf8');

	// 既定タブの削除は no-op（同じオブジェクトが返る）— ファイルが触られないこと
	await store.update((file) => file);
	assert.strictEqual(readFileSync(join(where, 'groups.json'), 'utf8'), before);
});
