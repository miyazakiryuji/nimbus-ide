/*---------------------------------------------------------------------------------------------
 *  Nimbus 拡張のバンドル設定。
 *
 *  Claude Agent SDK は **バンドルに含めない**（external）。SDK は自分のパッケージ内にある
 *  Claude Code の実行ファイルを子プロセスとして起動するため、単一ファイルに畳み込むと
 *  その相対パスが壊れる。実体は node_modules として同梱する
 *  （build/lib/extensions.ts の packagedDependenciesByExtension に登録済み）。
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

async function copyNonTsFiles(outDir: string): Promise<void> {
	const entries = await fs.readdir(srcDir, { withFileTypes: true, recursive: true });
	for (const entry of entries) {
		if (!entry.isFile() || entry.name.endsWith('.ts')) {
			continue;
		}
		const srcPath = path.join(entry.parentPath, entry.name);
		const relativePath = path.relative(srcDir, srcPath);
		const destPath = path.join(outDir, relativePath);
		await fs.mkdir(path.dirname(destPath), { recursive: true });
		await fs.copyFile(srcPath, destPath);
	}
}

run({
	platform: 'node',
	entryPoints: {
		'extension': path.join(srcDir, 'extension.ts'),
	},
	srcDir,
	outdir: outDir,
	additionalOptions: {
		external: ['vscode', '@anthropic-ai/claude-agent-sdk'],
	},
}, process.argv, copyNonTsFiles);
