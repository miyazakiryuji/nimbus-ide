/**
 * 再現手順の生成（tasks.md T-143）— 実装中（@session-b）。
 * ログから「まず落ちるテスト」を起こす。骨格のみ。
 */
export type TestFramework = 'node' | 'vitest' | 'jest' | 'dart';

/** package.json / pubspec.yaml の中身から、使うテストの書き方を決める */
export function detectFramework(files: readonly string[], manifest: string): TestFramework | undefined {
	if (files.includes('pubspec.yaml')) {
		return 'dart';
	}
	if (!files.includes('package.json')) {
		return undefined;
	}
	if (/"vitest"\s*:/.test(manifest)) {
		return 'vitest';
	}
	if (/"jest"\s*:/.test(manifest)) {
		return 'jest';
	}
	return 'node';
}
