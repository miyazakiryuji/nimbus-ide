/**
 * ホットリロード連携（T-072）の判断の単体テスト。
 *
 * **上限で止まること**が一番大事。止まらないと、直す → 撮る → 直す が延々続き、
 * 枠も費用も溶ける。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildScreenshotCommand,
	reloadPrompt,
	shouldReload,
	touchesWatchedFiles,
	type HotReloadConfig
} from '../core/hotReload';

const config = (over: Partial<HotReloadConfig> = {}): HotReloadConfig => ({
	enabled: true,
	reloadCommand: 'echo reload',
	screenshotCommand: 'shot {file}',
	extensions: ['.dart'],
	maxRounds: 3,
	...over
});

test('既定オフ・コマンド未設定では回さない', () => {
	assert.deepStrictEqual(shouldReload(config({ enabled: false }), ['a.dart'], 0), { run: false, reason: 'disabled' });
	assert.deepStrictEqual(shouldReload(config({ screenshotCommand: '  ' }), ['a.dart'], 0), {
		run: false,
		reason: 'no-command'
	});
});

test('対象の拡張子が変わったときだけ回す', () => {
	assert.deepStrictEqual(shouldReload(config(), ['lib/a.dart'], 0), { run: true });
	assert.deepStrictEqual(shouldReload(config(), ['README.md'], 0), { run: false, reason: 'not-watched' });
	assert.deepStrictEqual(shouldReload(config(), [], 0), { run: false, reason: 'not-watched' });
	// 拡張子の指定が空なら、変更があれば常に回す
	assert.deepStrictEqual(shouldReload(config({ extensions: [] }), ['README.md'], 0), { run: true });
});

test('上限に達したら回さない（これが無いと止まらない）', () => {
	assert.deepStrictEqual(shouldReload(config(), ['a.dart'], 2), { run: true });
	assert.deepStrictEqual(shouldReload(config(), ['a.dart'], 3), { run: false, reason: 'max-rounds' });
	// 上限 0 を「無制限」と読まない。最低 1 周に丸める
	assert.deepStrictEqual(shouldReload(config({ maxRounds: 0 }), ['a.dart'], 1), { run: false, reason: 'max-rounds' });
});

test('監視対象の判定', () => {
	assert.strictEqual(touchesWatchedFiles(['a/b/c.dart'], ['.dart']), true);
	assert.strictEqual(touchesWatchedFiles(['a/b/c.ts'], ['.dart']), false);
	assert.strictEqual(touchesWatchedFiles([], []), false);
});

test('{file} を出力先に差し替える。無ければ末尾に足す', () => {
	assert.strictEqual(buildScreenshotCommand('shot {file} --png', '/tmp/a.png'), 'shot /tmp/a.png --png');
	assert.strictEqual(buildScreenshotCommand('shot', '/tmp/a.png'), 'shot /tmp/a.png');
	// 複数箇所も置き換える
	assert.strictEqual(buildScreenshotCommand('a {file} b {file}', '/x'), 'a /x b /x');
});

test('投入する指示には周回数と、止めてよい条件が入る', () => {
	const prompt = reloadPrompt(2, 3);
	assert.ok(prompt.includes('2 / 3 周目'));
	assert.ok(prompt.includes('完了'));
});
