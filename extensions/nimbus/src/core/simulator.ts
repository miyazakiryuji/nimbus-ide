/**
 * シミュレータを操作して、動くところまで確かめさせる（tasks.md T-073）。
 *
 * 「実装できました」と「画面が動きました」の間には距離がある。
 * コードが通っても、**押したら落ちる**ことはいくらでもある。
 *
 * ここでやることは 2 つ:
 *
 * 1. **画面を撮って渡す** — 文字の説明より、撮った画面 1 枚のほうが早い
 * 2. **流れをテストに起こす** — 人が書いた「ログインを押す → ホームが出る」を
 *    `integration_test` に変換する。**一度テストになれば、次からは人が押さなくていい**
 *
 * タップの代行を `simctl` で直接やらない理由: `simctl` に座標タップの口は無く、
 * 座標を打つ道は**画面が変わるたびに壊れる**。Flutter には `integration_test` があるので、
 * **要素の名前で押す**形に落とす。そのほうが壊れにくく、資産として残る。
 *
 * VS Code に依存しない。
 */

export interface SimDevice {
	udid: string;
	name: string;
	/** `Booted` / `Shutdown` など */
	state: string;
	/** `iOS 18.2` のような表示名 */
	runtime: string;
	isAvailable: boolean;
}

/** `xcrun simctl list devices --json` を読む */
export function parseDeviceList(json: string): SimDevice[] {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (typeof raw !== 'object' || raw === null) {
		return [];
	}
	const devices = (raw as Record<string, unknown>).devices;
	if (typeof devices !== 'object' || devices === null) {
		return [];
	}
	const found: SimDevice[] = [];
	for (const [runtimeKey, list] of Object.entries(devices as Record<string, unknown>)) {
		if (!Array.isArray(list)) {
			continue;
		}
		const runtime = runtimeLabel(runtimeKey);
		for (const entry of list) {
			if (typeof entry !== 'object' || entry === null) {
				continue;
			}
			const record = entry as Record<string, unknown>;
			if (typeof record.udid !== 'string' || typeof record.name !== 'string') {
				continue;
			}
			found.push({
				udid: record.udid,
				name: record.name,
				state: typeof record.state === 'string' ? record.state : 'Unknown',
				runtime,
				// `isAvailable` が無い古い形式では、使える前提で読む
				isAvailable: record.isAvailable !== false
			});
		}
	}
	return found;
}

/** `com.apple.CoreSimulator.SimRuntime.iOS-18-2` → `iOS 18.2` */
function runtimeLabel(key: string): string {
	const match = key.match(/SimRuntime\.(?<os>[A-Za-z]+)-(?<version>[\d-]+)$/);
	if (!match?.groups) {
		return key;
	}
	return `${match.groups.os} ${match.groups.version.replace(/-/g, '.')}`;
}

/** 使える端末だけ。**起動中を先に**（すぐ撮れるので） */
export function usableDevices(devices: readonly SimDevice[]): SimDevice[] {
	return devices
		.filter((device) => device.isAvailable)
		.sort((a, b) => {
			const booted = Number(b.state === 'Booted') - Number(a.state === 'Booted');
			return booted || a.name.localeCompare(b.name);
		});
}

/* ------------------------------------------------------------------ *
 * 流れをテストに起こす
 * ------------------------------------------------------------------ */

export type StepKind = 'tap' | 'enter' | 'expect' | 'wait';

export interface FlowStep {
	kind: StepKind;
	/** 押す・確かめる相手（画面に見えている文字） */
	target: string;
	/** `enter` のときだけ使う */
	value?: string;
}

const STEP_WORDS: [RegExp, StepKind][] = [
	[/^(?:tap|押す|タップ)[:：]?\s*/i, 'tap'],
	[/^(?:enter|入力)[:：]?\s*/i, 'enter'],
	[/^(?:expect|確かめる|出る)[:：]?\s*/i, 'expect'],
	[/^(?:wait|待つ)[:：]?\s*/i, 'wait']
];

/**
 * 人が書いた流れを読む。1 行 1 手順。
 *
 * ```
 * タップ: ログイン
 * 入力: メールアドレス = a@example.com
 * 確かめる: ホーム
 * ```
 *
 * **書き方を覚えさせない。** 頭の言葉が無い行は「押す」と読む
 * （流れを書くとき、いちばん多いのは押す操作なので）。
 */
export function parseFlow(text: string): FlowStep[] {
	const steps: FlowStep[] = [];
	for (const raw of text.split('\n')) {
		const line = raw.replace(/^[\s\d.、,)-]*/, '').trim();
		if (line.length === 0) {
			continue;
		}
		let kind: StepKind = 'tap';
		let rest = line;
		for (const [pattern, word] of STEP_WORDS) {
			if (pattern.test(line)) {
				kind = word;
				rest = line.replace(pattern, '').trim();
				break;
			}
		}
		if (kind === 'wait') {
			// 「待つ」だけの行に相手はいない
			steps.push({ kind, target: rest.length > 0 ? rest : '待つ' });
			continue;
		}
		if (rest.length === 0) {
			continue;
		}
		if (kind === 'enter') {
			const [target, ...value] = rest.split(/\s*[=＝]\s*/);
			steps.push({ kind, target: target.trim(), value: value.join('=').trim() });
			continue;
		}
		steps.push({ kind, target: rest });
	}
	return steps;
}

function dartString(text: string): string {
	return `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\$/g, '\\$')}'`;
}

/**
 * `integration_test` の下書きを作る。
 *
 * **見えている文字で探す**（`find.text`）。キーを振る方が堅いが、
 * まだ振られていないことのほうが多いので、動く形を先に出す。
 * 直すのは人（またはエージェント）の仕事。
 */
export function renderFlowTest(steps: readonly FlowStep[], title: string): string {
	if (steps.length === 0) {
		return '';
	}
	const body: string[] = [];
	for (const step of steps) {
		switch (step.kind) {
			case 'tap':
				body.push(
					`    await tester.tap(find.text(${dartString(step.target)}));`,
					'    await tester.pumpAndSettle();'
				);
				break;
			case 'enter':
				body.push(
					`    await tester.enterText(find.widgetWithText(TextField, ${dartString(step.target)}), ${dartString(step.value ?? '')});`,
					'    await tester.pumpAndSettle();'
				);
				break;
			case 'expect':
				body.push(`    expect(find.text(${dartString(step.target)}), findsOneWidget);`);
				break;
			case 'wait':
				body.push('    await tester.pumpAndSettle(const Duration(seconds: 2));');
				break;
		}
	}
	return [
		"import 'package:flutter/material.dart';",
		"import 'package:flutter_test/flutter_test.dart';",
		"import 'package:integration_test/integration_test.dart';",
		'',
		'// Nimbus が流れから起こした下書きです。',
		'// find.text は画面の文字に依存します。Key が振れる場所は Key に置き換えてください。',
		'',
		'void main() {',
		'  IntegrationTestWidgetsFlutterBinding.ensureInitialized();',
		'',
		`  testWidgets(${dartString(title)}, (tester) async {`,
		'    // TODO: アプリの起点を呼びます（例: app.main(); await tester.pumpAndSettle();）',
		...body,
		'  });',
		'}',
		''
	].join('\n');
}

/** 画面に出す要約 */
export function describeFlow(steps: readonly FlowStep[]): string {
	if (steps.length === 0) {
		return '手順を読み取れませんでした。';
	}
	const labels: Record<StepKind, string> = { tap: '押す', enter: '入力', expect: '確かめる', wait: '待つ' };
	return [
		`${steps.length} 手順`,
		...steps.map((step, index) => `  ${index + 1}. ${labels[step.kind]}: ${step.target}${step.value ? ` = ${step.value}` : ''}`)
	].join('\n');
}

/**
 * 撮った画面をセッションに渡す文。
 *
 * **「動いていますか」ではなく「何が見えますか」から入る。**
 * 先に「動いているはず」と言うと、それに合う説明が返ってくる。
 */
export function buildScreenshotPrompt(imagePath: string, question?: string): string {
	return [
		`シミュレータの画面を撮りました: ${imagePath}`,
		'',
		'この画像を読んで、**何が見えているか**を先に書いてください。',
		...(question ? ['', `そのうえで: ${question}`] : []),
		'',
		'**期待した状態かどうかは、見えているものを書いたあとで判断してください。**',
		'画像から読み取れないことは「読み取れない」と言ってください。'
	].join('\n');
}
