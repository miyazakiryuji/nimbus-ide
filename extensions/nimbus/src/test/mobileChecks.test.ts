/**
 * モバイルの提出前チェック（T-196 / T-197 / T-201）の単体テスト。
 *
 * 「審査に通る」と断言しないこと、説明文が空になった変化を拾うことを押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { checkSubmission, diffPermissions, parseUsageDescriptions, renderMobileChecks } from '../core/mobileChecks';

const plist = (entries: [string, string][]): string =>
	['<plist><dict>', ...entries.map(([k, v]) => `<key>${k}</key>\n<string>${v}</string>`), '</dict></plist>'].join('\n');

test('Info.plist から権限の説明文を取り出す', () => {
	assert.deepStrictEqual(
		[...parseUsageDescriptions(plist([['NSCameraUsageDescription', '写真を撮るため'], ['CFBundleName', 'app']]))],
		[['NSCameraUsageDescription', '写真を撮るため']]
	);
});

test('増えた権限を、説明文つきで拾う', () => {
	const changes = diffPermissions(plist([]), plist([['NSMicrophoneUsageDescription', '録音のため']]));
	assert.deepStrictEqual(changes, [
		{ key: 'NSMicrophoneUsageDescription', kind: 'added', description: '録音のため' }
	]);
});

test('説明文が空になった変化も拾う（キーだけ残ると審査で弾かれる）', () => {
	const changes = diffPermissions(
		plist([['NSCameraUsageDescription', '写真を撮るため']]),
		plist([['NSCameraUsageDescription', '']])
	);
	assert.deepStrictEqual(changes.map((c) => c.kind), ['emptied']);
});

test('消えた権限も拾う', () => {
	const changes = diffPermissions(plist([['NSCameraUsageDescription', 'x']]), plist([]));
	assert.deepStrictEqual(changes.map((c) => c.kind), ['removed']);
});

test('空の説明文があれば提出前チェックで落とす', () => {
	const [first] = checkSubmission({ plist: plist([['NSCameraUsageDescription', '']]), hasPrivacyManifest: true });
	assert.deepStrictEqual({ ok: first.ok, hasNote: Boolean(first.note) }, { ok: false, hasNote: true });
});

test('プライバシーマニフェストの有無を見る', () => {
	const checks = checkSubmission({ hasPrivacyManifest: false });
	assert.strictEqual(checks[1].ok, false);
});

test('前回の版が分かるときだけ、上がっているかを見る', () => {
	assert.deepStrictEqual(
		[
			checkSubmission({ hasPrivacyManifest: true, version: '1.0.0', lastReleasedVersion: '1.0.0' })[2].ok,
			checkSubmission({ hasPrivacyManifest: true, version: '1.0.1', lastReleasedVersion: '1.0.0' })[2].ok,
			checkSubmission({ hasPrivacyManifest: true, version: '1.0.0' })[2].ok
		],
		[false, true, true]
	);
});

test('審査に通るとは書かない', () => {
	const text = renderMobileChecks([], checkSubmission({ hasPrivacyManifest: true }));
	assert.ok(text.includes('審査に通るかどうかは判定していません'));
});
