/**
 * シミュレータ操作。
 *
 * 守りたいのは **「書き方を覚えさせない」**こと。
 * 頭の言葉が無い行は「押す」と読む — 流れを書くとき、いちばん多いのが押す操作なので。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import {
	buildScreenshotPrompt,
	describeFlow,
	parseDeviceList,
	parseFlow,
	renderFlowTest,
	usableDevices
} from '../core/simulator';

const DEVICES = JSON.stringify({
	devices: {
		'com.apple.CoreSimulator.SimRuntime.iOS-18-2': [
			{ udid: 'AAA', name: 'iPhone 16', state: 'Shutdown', isAvailable: true },
			{ udid: 'BBB', name: 'iPad Pro', state: 'Booted', isAvailable: true },
			{ udid: 'CCC', name: '古い端末', state: 'Shutdown', isAvailable: false }
		]
	}
});

test('端末一覧を読み、ランタイムを読める形に直す', () => {
	assert.deepStrictEqual(parseDeviceList(DEVICES)[0], {
		udid: 'AAA',
		name: 'iPhone 16',
		state: 'Shutdown',
		runtime: 'iOS 18.2',
		isAvailable: true
	});
	assert.deepStrictEqual(parseDeviceList('壊れています'), []);
	assert.deepStrictEqual(parseDeviceList('{"devices": 1}'), []);
});

test('使えない端末は落とし、起動中を先に出す', () => {
	assert.deepStrictEqual(
		usableDevices(parseDeviceList(DEVICES)).map((device) => device.name),
		['iPad Pro', 'iPhone 16']
	);
});

const FLOW = parseFlow(
	[
		'1. タップ: ログイン',
		'入力: メールアドレス = a@example.com',
		'確かめる: ホーム',
		'待つ',
		'設定'
	].join('\n')
);

test('頭の言葉が無い行は「押す」と読む', () => {
	assert.deepStrictEqual(FLOW, [
		{ kind: 'tap', target: 'ログイン' },
		{ kind: 'enter', target: 'メールアドレス', value: 'a@example.com' },
		{ kind: 'expect', target: 'ホーム' },
		{ kind: 'wait', target: '待つ' },
		{ kind: 'tap', target: '設定' }
	]);
});

test('手順の一覧を出す', () => {
	assert.strictEqual(
		describeFlow(FLOW),
		[
			'5 手順',
			'  1. 押す: ログイン',
			'  2. 入力: メールアドレス = a@example.com',
			'  3. 確かめる: ホーム',
			'  4. 待つ: 待つ',
			'  5. 押す: 設定'
		].join('\n')
	);
	assert.strictEqual(describeFlow([]), '手順を読み取れませんでした。');
});

test('integration_test の下書きを起こす', () => {
	const dart = renderFlowTest(FLOW, 'ログインしてホームへ');
	assert.ok(dart.includes("import 'package:integration_test/integration_test.dart';"), dart);
	assert.ok(dart.includes("await tester.tap(find.text('ログイン'));"), dart);
	assert.ok(dart.includes("find.widgetWithText(TextField, 'メールアドレス'), 'a@example.com'"), dart);
	assert.ok(dart.includes("expect(find.text('ホーム'), findsOneWidget);"), dart);
	assert.strictEqual(renderFlowTest([], 'なし'), '');
});

test('Dart の文字列に混ぜ込めない', () => {
	const dart = renderFlowTest(parseFlow("タップ: it's $x"), 'x');
	assert.ok(dart.includes("find.text('it\\'s \\$x')"), dart);
});

test('画面を渡す文は「何が見えるか」から入る', () => {
	const prompt = buildScreenshotPrompt('/tmp/a.png', 'ボタンは押せる状態ですか');
	assert.ok(prompt.includes('**何が見えているか**を先に書いてください。'), prompt);
	assert.ok(prompt.includes('ボタンは押せる状態ですか'), prompt);
	assert.ok(prompt.includes('読み取れないことは「読み取れない」と言ってください'), prompt);
});
