/**
 * Hooks の組み立てとドライラン（T-026 / T-161）の単体テスト。
 *
 * `settings.json` は**利用者の設定ファイル**なので、こちらが壊すと影響が大きい。
 * 「空になった入れ物を残さない」「同じ matcher を分裂させない」を押さえる。
 *
 *   node --test extensions/nimbus/out/test
 */
import * as assert from 'assert';
import { readFileSync } from 'fs';
import { join } from 'path';
import { test } from 'node:test';
import {
	addHook,
	ALL_HOOK_EVENTS,
	COMMON_HOOK_EVENTS,
	dryRunPayload,
	flattenHooks,
	interpretExitCode,
	removeHook,
	usesMatcher,
	type HooksConfig
} from '../core/hooks';

test('フックイベントは 31 種類（タスクの「要確認」の答え）', () => {
	assert.strictEqual(ALL_HOOK_EVENTS.length, 31);
	// 実務で使う 5 つが先頭に並んでいる
	assert.deepStrictEqual(ALL_HOOK_EVENTS.slice(0, 5), [...COMMON_HOOK_EVENTS]);
});

test('matcher が意味を持つのはツールに紐づくイベントだけ', () => {
	assert.ok(usesMatcher('PreToolUse'));
	assert.ok(usesMatcher('PostToolUse'));
	assert.ok(!usesMatcher('SessionStart'));
	assert.ok(!usesMatcher('Stop'));
});

test('同じイベント・同じ matcher なら、既にある入れ物へ足す', () => {
	let config: HooksConfig = {};
	config = addHook(config, 'PreToolUse', 'Bash', 'a.sh');
	config = addHook(config, 'PreToolUse', 'Bash', 'b.sh');
	assert.strictEqual(config.PreToolUse?.length, 1, 'matcher ごとに分裂している');
	assert.deepStrictEqual(config.PreToolUse?.[0].hooks.map((h) => h.command), ['a.sh', 'b.sh']);
});

test('matcher が違えば別の入れ物になる', () => {
	let config: HooksConfig = {};
	config = addHook(config, 'PreToolUse', 'Bash', 'a.sh');
	config = addHook(config, 'PreToolUse', 'Write', 'b.sh');
	assert.strictEqual(config.PreToolUse?.length, 2);
});

test('matcher を使わないイベントでは matcher を書かない', () => {
	const config = addHook({}, 'SessionStart', 'Bash', 'a.sh');
	assert.strictEqual(config.SessionStart?.[0].matcher, undefined);
});

test('外したときに、空になった入れ物を残さない', () => {
	let config: HooksConfig = addHook({}, 'PreToolUse', 'Bash', 'a.sh');
	config = removeHook(config, 'PreToolUse', 0, 0);
	assert.deepStrictEqual(config, {}, '空の配列やキーが残っている');
});

test('複数あるうちの 1 つだけを外す', () => {
	let config: HooksConfig = addHook({}, 'PreToolUse', 'Bash', 'a.sh');
	config = addHook(config, 'PreToolUse', 'Bash', 'b.sh');
	config = removeHook(config, 'PreToolUse', 0, 0);
	assert.deepStrictEqual(config.PreToolUse?.[0].hooks.map((h) => h.command), ['b.sh']);
});

test('無いものを外そうとしても壊さない', () => {
	const config: HooksConfig = addHook({}, 'Stop', undefined, 'a.sh');
	assert.deepStrictEqual(removeHook(config, 'Stop', 9, 9), config);
});

test('一覧はよく使う 5 つを先に並べる', () => {
	let config: HooksConfig = addHook({}, 'PreCompact', undefined, 'z.sh');
	config = addHook(config, 'Stop', undefined, 'y.sh');
	config = addHook(config, 'PreToolUse', 'Bash', 'x.sh');
	assert.deepStrictEqual(
		flattenHooks(config).map((row) => row.event),
		['PreToolUse', 'Stop', 'PreCompact']
	);
});

test('ドライランの入力は本番と同じ形。中身は作り物と分かる値にする', () => {
	const payload = JSON.parse(dryRunPayload('PreToolUse', '/w'));
	assert.deepStrictEqual(
		[payload.hook_event_name, payload.tool_name, payload.session_id, payload.cwd],
		['PreToolUse', 'Bash', 'nimbus-dry-run', '/w']
	);
	// 実際に消したり送ったりしないコマンドを入れる
	assert.strictEqual(payload.tool_input.command, 'echo nimbus-dry-run');
	assert.strictEqual(JSON.parse(dryRunPayload('UserPromptSubmit', '/w')).prompt.includes('ドライラン'), true);
	// ツールに紐づかないイベントでは tool_name を入れない
	assert.strictEqual(JSON.parse(dryRunPayload('SessionStart', '/w')).tool_name, undefined);
});

test('読めない settings.json を、空とみなして上書きしない（T-352）', () => {
	// 保存先を触るのは `hooksBuilder.ts`。あちらは `vscode` を取り込むので、拡張ホスト無しで
	// 走るこのテストからは import できない。現物の消失は敵対ケース
	// `nimbus/tests/gui/cases/adv-08-unreadable-settings.mjs` が押さえているので、
	// ここでは**「無い」と「読めない」が同じ catch へ畳み戻っていないこと**をソースで留める。
	const source = readFileSync(
		join(process.cwd(), 'extensions', 'nimbus', 'src', 'hooksBuilder.ts'),
		'utf8'
	);
	assert.deepStrictEqual(
		{
			'「無い」は今までどおり新規作成': /FileNotFound|ENOENT/.test(source),
			'「読めない」を別に扱う': /NoPermissions|EACCES/.test(source),
			'読めないときは書かずに理由を言う': source.includes('フックを保存しませんでした'),
			// ボタンの無いエラー通知は 15 秒で自動的に消える。消えると「保存できた」と
			// 思い込ませてしまうので、ボタンを添えて居座らせている（外すと adv-08 も落ちる）
			'その知らせは自動で消えない（ボタン付き）': source.includes('showErrorMessage(message, COPY)'),
			'壊れた JSON は空から始める（意図した振る舞い・変えない）':
				source.includes('壊れた JSON は空から始める')
		},
		{
			'「無い」は今までどおり新規作成': true,
			'「読めない」を別に扱う': true,
			'読めないときは書かずに理由を言う': true,
			'その知らせは自動で消えない（ボタン付き）': true,
			'壊れた JSON は空から始める（意図した振る舞い・変えない）': true
		}
	);
});

test('終了コード 2 だけが「止めた」。ほかの非ゼロはフック側の不具合', () => {
	assert.strictEqual(interpretExitCode(0).verdict, 'allowed');
	assert.strictEqual(interpretExitCode(2).verdict, 'blocked');
	assert.strictEqual(interpretExitCode(1).verdict, 'error');
	assert.strictEqual(interpretExitCode(127).verdict, 'error');
});
