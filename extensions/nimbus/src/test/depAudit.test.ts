/**
 * 依存を足す前の確認（T-118）の単体テスト。
 *
 * **良し悪しを決めない**（数字だけ出す）を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { audit, daysSince, findSimilar, renderAudit } from '../core/depAudit';

const now = Date.parse('2026-08-13T00:00:00.000Z');

test('最終更新からの日数を数える', () => {
	assert.strictEqual(daysSince('2026-08-03T00:00:00.000Z', now), 10);
});

test('1 年以上更新が無ければ触れる', () => {
	const result = audit({ name: 'old', lastPublished: '2024-01-01T00:00:00.000Z', license: 'MIT' }, now);
	assert.ok(result.flags.includes('stale'));
});

test('使っている人が少なければ触れる', () => {
	assert.ok(audit({ name: 'rare', weeklyDownloads: 12, license: 'MIT' }, now).flags.includes('few-users'));
});

test('引っ張る依存が多ければ触れる', () => {
	assert.ok(audit({ name: 'big', dependencyCount: 42, license: 'MIT' }, now).flags.includes('heavy'));
});

test('非推奨は理由ごと出す', () => {
	const result = audit({ name: 'gone', deprecated: 'use foo instead', license: 'MIT' }, now);
	assert.deepStrictEqual(
		{ flag: result.flags.includes('deprecated'), note: result.notes.some((n) => n.includes('use foo instead')) },
		{ flag: true, note: true }
	);
});

test('ライセンスの記載が無ければ触れる', () => {
	assert.ok(audit({ name: 'x' }, now).flags.includes('unknown-license'));
});

test('似た名前の、既に入っているものを見つける', () => {
	assert.deepStrictEqual(findSimilar('date-fns', ['dayjs', 'date_fns_tz', 'react']), ['date_fns_tz']);
	assert.deepStrictEqual(findSimilar('@scope/http-client', ['http.client']), ['http.client']);
});

test('自分自身は似ているとしない', () => {
	assert.deepStrictEqual(findSimilar('react', ['react']), []);
});

test('良し悪しは決めないと書く', () => {
	const text = renderAudit(audit({ name: 'x', weeklyDownloads: 1 }, now));
	assert.ok(text.includes('良し悪しは決めていません'));
});

test('気になる点が無ければ、そう書く', () => {
	const result = audit(
		{ name: 'ok', lastPublished: '2026-08-01T00:00:00.000Z', weeklyDownloads: 900000, license: 'MIT', dependencyCount: 1 },
		now
	);
	assert.ok(renderAudit(result).includes('気になる点はありませんでした'));
});
