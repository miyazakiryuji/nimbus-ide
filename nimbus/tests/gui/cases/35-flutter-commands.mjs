/**
 * Flutter まわりのコマンドが、実際の Flutter プロジェクトで動くか。
 *
 * 仕様側の「画面確認（実際の Flutter プロジェクトで開く・未実施）」がこれ:
 * `dep-consistency` / `flutter-lint`。
 *
 * **実セッション（課金）も Flutter SDK も要らない。**
 * どちらも `pubspec.yaml` / `pubspec.lock` と `.dart` を読むだけ。
 *
 * **食い違いのある材料をわざと置く。** 材料が無いと
 * 「見つかりませんでした」でも通ってしまい、読めていないことに気づけない。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { closeAllEditors, labels, runCommand } from '../helpers.mjs';

async function allEditorsText(page) {
	const texts = await page.evaluate(() =>
		[...document.querySelectorAll('.editor-instance .view-lines')].map((node) => node.innerText)
	);
	return texts.join('\n---\n');
}

/**
 * 空白を落として比べる。
 *
 * エディタは行を `<span>` に割るので、**Latin と日本語の境目の空白が
 * `innerText` に出たり出なかったりする**（「Flutter の確認」で実際に外した）。
 * 見たいのは語が出ているかなので、空白の有無で落とさない。
 */
const squash = (text) => text.replace(/\s+/gu, '');

async function openAndRead(page, title, needle, { attempts = 12 } = {}) {
	await runCommand(page, title);
	let text = '';
	for (let i = 0; i < attempts; i++) {
		await page.waitForTimeout(700);
		text = await allEditorsText(page);
		if (squash(text).includes(squash(needle))) {
			return text;
		}
	}
	return text;
}

export default {
	name: 'Flutter のコマンドが、実際の pubspec と .dart から答えを出す',
	async run(page, ctx) {
		await closeAllEditors(page);

		// `pubspec.yaml` の書きかたと `pubspec.lock` の実際がずれている状態を作る
		writeFileSync(
			join(ctx.workspace, 'pubspec.yaml'),
			['name: sample_app', 'environment:', "  sdk: '>=3.0.0 <4.0.0'", 'dependencies:', '  http: ^1.0.0', '  intl: ^0.18.0', '  provider: ^6.0.0', ''].join('\n')
		);
		writeFileSync(
			join(ctx.workspace, 'pubspec.lock'),
			[
				'packages:',
				'  http:',
				'    dependency: "direct main"',
				'    version: "2.5.0"',
				'  intl:',
				'    dependency: "direct main"',
				'    version: "0.18.1"',
				''
			].join('\n')
		);
		// 読み上げに出ない画像と、翻訳していない文言（`flutter-lint` が見るもの）
		mkdirSync(join(ctx.workspace, 'lib'), { recursive: true });
		writeFileSync(
			join(ctx.workspace, 'lib', 'main.dart'),
			[
				"import 'package:flutter/material.dart';",
				'',
				'class Sample extends StatelessWidget {',
				'  @override',
				'  Widget build(BuildContext context) {',
				"    return Column(children: [",
				"      Image.asset('assets/logo.png'),",
				"      const Text('こんにちは'),",
				'    ]);',
				'  }',
				'}',
				''
			].join('\n')
		);
		await page.waitForTimeout(1500);

		// **中身はその場で見る。** 次の文書を開くと、前の文書の行は DOM から消える
		// （エディタは見えている行しか描かない）ので、後からまとめては読めない。
		const missing = [];
		for (const [key, heading, content, why] of [
			['command.openDepConsistency', '依存の食い違い', 'provider', 'lock に無い依存（provider）を拾えていない＝pub get していない状態を見つけられていない'],
			['command.openFlutterLint', 'Flutter の確認', '直書きの文言', '置いた直書きの文言が拾えていない']
		]) {
			const text = await openAndRead(page, labels(key)[0], heading);
			if (!squash(text).includes(squash(heading))) {
				missing.push(`${key} → 「${heading}」が出ない（実際: ${text.slice(0, 140).replace(/\n/g, ' ')}）`);
				continue;
			}
			if (!squash(text).includes(squash(content))) {
				missing.push(`${key} → ${why}（実際: ${text.slice(0, 200).replace(/\n/g, ' ')}）`);
			}
		}
		ctx.expect(missing.length === 0, missing.join('\n'));

		await ctx.shot('flutter-commands');

		ctx.expect((await closeAllEditors(page)) === 0, '文書を閉じきれていない（次のケースを汚す）');
	}
};
