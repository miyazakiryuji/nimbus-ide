/**
 * 開いている Dart から Widget テスト / ゴールデンテストの雛形を作る（tasks.md T-193）。
 *
 * 「テストを書いて」と頼むだけなら Claude Code 単体でできる。ここが引き受けるのは
 * **エディタでないと分からないこと** — いま開いているファイル、その package の名前、
 * 規約どおりの置き場所。判断そのもの（何を確かめるか）は人と Claude に残す。
 *
 * 読み取りの本体は `core/widgetTests.ts`（VS Code 非依存・単体テスト済み）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import * as vscode from 'vscode';
import {
	buildTestSource,
	findWidgets,
	packageImport,
	packageNameOf,
	testPathFor,
	type WidgetInfo
} from './core/widgetTests';

/** ファイルから上へ辿って、いちばん近い pubspec.yaml のあるフォルダを探す（モノレポ対応） */
function findPackageRoot(filePath: string): string | undefined {
	let dir = dirname(filePath);
	// ルートに着いたら止まる
	for (let depth = 0; depth < 40; depth++) {
		if (existsSync(join(dir, 'pubspec.yaml'))) {
			return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
	return undefined;
}

async function pickWidget(widgets: WidgetInfo[]): Promise<WidgetInfo | undefined> {
	if (widgets.length === 1) {
		return widgets[0];
	}
	const picked = await vscode.window.showQuickPick(
		widgets.map((widget) => ({
			label: widget.name,
			description: widget.kind === 'stateless' ? 'StatelessWidget' : 'StatefulWidget',
			detail: widget.params.length > 0
				? widget.params.map((p) => `${p.name}: ${p.type}`).join(' / ')
				: '引数なし',
			widget
		})),
		{ title: 'Nimbus: どの widget のテストを作りますか' }
	);
	return picked?.widget;
}

export async function generateWidgetTest(): Promise<void> {
	const editor = vscode.window.activeTextEditor;
	if (!editor || !editor.document.fileName.endsWith('.dart')) {
		void vscode.window.showInformationMessage('Nimbus: Dart のファイルを開いてから実行してください。');
		return;
	}
	const filePath = editor.document.fileName;
	const root = findPackageRoot(filePath);
	if (!root) {
		void vscode.window.showErrorMessage('Nimbus: pubspec.yaml が見つかりません（Flutter / Dart の package の中で実行してください）。');
		return;
	}
	const relativePath = relative(root, filePath).split(sep).join('/');
	const testRelative = testPathFor(relativePath);
	if (!testRelative) {
		void vscode.window.showInformationMessage('Nimbus: lib/ の下の .dart ファイルで実行してください（テストの置き場所が決まらないため）。');
		return;
	}

	const widgets = findWidgets(editor.document.getText());
	if (widgets.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: このファイルに StatelessWidget / StatefulWidget が見つかりませんでした。');
		return;
	}
	const widget = await pickWidget(widgets);
	if (!widget) {
		return;
	}

	const GOLDEN = '見た目の比較（ゴールデン）も作る';
	const PLAIN = 'Widget テストだけ作る';
	const choice = await vscode.window.showQuickPick([PLAIN, GOLDEN], {
		title: `Nimbus: ${widget.name} のテスト`
	});
	if (!choice) {
		return;
	}

	let packageName: string | undefined;
	try {
		packageName = packageNameOf(readFileSync(join(root, 'pubspec.yaml'), 'utf8'));
	} catch {
		packageName = undefined;
	}
	if (!packageName) {
		void vscode.window.showErrorMessage('Nimbus: pubspec.yaml から package 名を読めませんでした。');
		return;
	}
	const importPath = packageImport(packageName, relativePath);
	if (!importPath) {
		void vscode.window.showInformationMessage('Nimbus: lib/ の下の .dart ファイルで実行してください。');
		return;
	}

	const target = join(root, testRelative);
	if (existsSync(target)) {
		// 既にあるものを黙って潰さない。書いたテストが消えるのが一番困る
		const OPEN = '開く';
		const answer = await vscode.window.showWarningMessage(
			`Nimbus: ${testRelative} は既にあります。`,
			{ modal: true, detail: '中身はそのままにします。開いて手で足してください。' },
			OPEN
		);
		if (answer === OPEN) {
			await vscode.window.showTextDocument(vscode.Uri.file(target));
		}
		return;
	}

	const source = buildTestSource({ widget, importPath, golden: choice === GOLDEN });
	try {
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, source, 'utf8');
	} catch (error) {
		void vscode.window.showErrorMessage(`Nimbus: テストを書き出せませんでした: ${error instanceof Error ? error.message : String(error)}`);
		return;
	}
	await vscode.window.showTextDocument(vscode.Uri.file(target));
	void vscode.window.showInformationMessage(
		choice === GOLDEN
			? `Nimbus: ${testRelative} を作りました。初回は flutter test --update-goldens で基準の画像を作ります。`
			: `Nimbus: ${testRelative} を作りました。`
	);
}
