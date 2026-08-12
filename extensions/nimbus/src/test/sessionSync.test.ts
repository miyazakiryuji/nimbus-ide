/**
 * マシンをまたいでセッションを続ける。
 *
 * 運んで困るのは会話ではなく**前提のほう**。
 * 守るのは「ずれていることを黙って続けない」こと。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	bundleName,
	buildResumePrompt,
	compareEnvironment,
	describeComparison,
	parseManifest,
	renderManifest,
	type SyncManifest
} from '../core/sessionSync';

const MANIFEST: SyncManifest = {
	version: 1,
	sessionId: 's-1',
	repoUrl: 'https://github.com/owner/repo',
	branch: 'nimbus',
	head: 'abcdef1234567890',
	dirty: false,
	machine: '会社の Mac',
	exportedAt: '2026-08-13T04:00:00Z',
	transcriptFile: 'transcript.jsonl',
	note: '承認まわりを直している途中'
};

test('版が合わない束は読まない', () => {
	assert.deepStrictEqual(parseManifest(renderManifest(MANIFEST)), MANIFEST);
	assert.strictEqual(parseManifest('壊れています'), undefined);
	assert.strictEqual(parseManifest('{"version": 2, "sessionId": "s", "transcriptFile": "t"}'), undefined);
	assert.strictEqual(parseManifest('{"version": 1}'), undefined);
});

const SAME = { repoUrl: 'https://github.com/owner/repo', branch: 'nimbus', head: 'abcdef1234567890', dirty: false };

test('同じ状態ならそのまま続けられる', () => {
	const comparison = compareEnvironment(MANIFEST, SAME);
	assert.deepStrictEqual(comparison, { verdict: 'ok', differences: [] });
	assert.strictEqual(buildResumePrompt(comparison), '');
});

test('別のリポジトリなら止める', () => {
	const comparison = compareEnvironment(MANIFEST, { ...SAME, repoUrl: 'https://github.com/other/repo' });
	assert.strictEqual(comparison.verdict, 'stop');
	assert.ok(comparison.differences[0].startsWith('別のリポジトリです'), comparison.differences[0]);
});

test('コミットや汚れは警告どまり。違いは全部挙げる', () => {
	const comparison = compareEnvironment(
		{ ...MANIFEST, dirty: true },
		{ ...SAME, branch: 'main', head: '99999999aaaa', dirty: true }
	);
	assert.strictEqual(comparison.verdict, 'warn');
	assert.deepStrictEqual(comparison.differences, [
		'枝が違います（nimbus → main）',
		'コミットが違います（abcdef12 → 99999999）',
		'出したとき、コミットしていない変更がありました（その内容はここにはありません）',
		'こちらにコミットしていない変更があります'
	]);
});

test('説明に出どころとメモが載る', () => {
	const comparison = compareEnvironment(MANIFEST, { ...SAME, head: 'ffffffff0000' });
	assert.strictEqual(
		describeComparison(MANIFEST, comparison),
		[
			'続けられますが、出したときと状態が違います',
			'  出どころ: 会社の Mac（2026-08-13T04:00:00Z）',
			'  メモ: 承認まわりを直している途中',
			'  コミットが違います（abcdef12 → ffffffff）'
		].join('\n')
	);
});

test('続きに入る文は、ずれを先に言い、読み直させる', () => {
	const comparison = compareEnvironment(MANIFEST, { ...SAME, head: 'ffffffff0000' });
	const prompt = buildResumePrompt(comparison);
	assert.ok(prompt.startsWith('別のマシンで続けていた会話の続きです。**そのときとファイルの状態が違います。**'), prompt);
	assert.ok(prompt.includes('**話に出てくるファイルを読み直してください。**'), prompt);
	assert.ok(prompt.includes('**覚えているつもりで書かないでください。**'), prompt);
});

test('束の名前は枝と日時から作る', () => {
	assert.strictEqual(bundleName(MANIFEST), 'nimbus-nimbus-20260813-040000');
	assert.strictEqual(
		bundleName({ ...MANIFEST, branch: 'feat/a b', exportedAt: '' }),
		'nimbus-feat-a-b-export'
	);
});
