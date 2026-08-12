/**
 * Platform Channel の突き合わせ（T-200）の単体テスト。
 *
 * **「無い」と言えるのは受け口が見つかっているときだけ**、という線を押さえる。
 */
import * as assert from 'assert';
import { test } from 'node:test';
import { crossCheck, parseDart, parseNative, renderChannelFindings } from '../core/platformChannel';

const dart = parseDart(
	'lib/native.dart',
	["const channel = MethodChannel('app/battery');", "await channel.invokeMethod('getLevel');", "await channel.invokeMethod<int>('getTemp');"].join('\n')
);

const swift = parseNative(
	'ios/Runner/AppDelegate.swift',
	[
		'let channel = FlutterMethodChannel(name: "app/battery", binaryMessenger: controller.binaryMessenger)',
		'switch call.method {',
		'case "getLevel":',
		'  result(42)',
		'default: result(FlutterMethodNotImplemented)'
	].join('\n')
);

test('Dart 側のチャネルと呼び出しを拾う', () => {
	assert.deepStrictEqual(dart, [
		{ channel: 'app/battery', methods: ['getLevel', 'getTemp'], file: 'lib/native.dart' }
	]);
});

test('Swift 側のチャネルと case を拾う', () => {
	assert.deepStrictEqual(swift.map((u) => `${u.channel}:${u.methods.join(',')}`), ['app/battery:getLevel']);
});

test('Kotlin の書き方も拾う', () => {
	const kotlin = parseNative(
		'MainActivity.kt',
		['MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "app/battery").setMethodCallHandler { call, result ->', '  "getLevel" -> result.success(42)'].join('\n')
	);
	assert.deepStrictEqual(kotlin.map((u) => `${u.channel}:${u.methods.join(',')}`), ['app/battery:getLevel']);
});

test('受け口の無いメソッドを挙げる', () => {
	assert.deepStrictEqual(
		crossCheck(dart, swift).filter((f) => f.kind === 'no-handler').map((f) => f.method),
		['getTemp']
	);
});

test('呼ばれていない受け口も挙げる', () => {
	const extra = parseNative('a.swift', ['FlutterMethodChannel(name: "app/battery")', 'case "unused":'].join('\n'));
	assert.deepStrictEqual(
		crossCheck(dart, extra).filter((f) => f.kind === 'unused-handler').map((f) => f.method),
		['unused']
	);
});

test('ネイティブ側が見つからないチャネルは、別枠にして断定しない', () => {
	const findings = crossCheck(parseDart('a.dart', "MethodChannel('plugin/x');\ninvokeMethod('y');"), []);
	assert.deepStrictEqual(findings.map((f) => f.kind), ['unknown-channel']);
	assert.ok(findings[0].message.includes('プラグインが提供しているなら問題ありません'));
});

test('食い違いが無ければ、その旨だけを書く', () => {
	assert.ok(renderChannelFindings([]).includes('見つかりませんでした'));
});

test('受け口が無いものには、実機で何が起きるかまで書く', () => {
	assert.ok(renderChannelFindings(crossCheck(dart, swift)).includes('MissingPluginException'));
});
