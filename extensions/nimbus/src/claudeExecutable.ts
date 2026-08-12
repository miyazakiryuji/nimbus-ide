/**
 * 使用する Claude Code 実行ファイルを決める。
 *
 * Nimbus は Claude Code 本体を同梱していない（プラットフォーム別バイナリだけで 280MB あり、
 * 利用者は自分のアカウントで認証済みの Claude Code を既に持っていることがほとんどのため）。
 * 代わりに、利用者の環境にあるものを確実に見つけにいく。
 *
 * 探索順:
 *   1. 設定 `nimbus.claudeCodeExecutable`（明示指定が最優先）
 *   2. SDK に同梱されたプラットフォーム別バイナリ（将来同梱する場合に効く）
 *   3. PATH と、よくあるインストール先
 *
 * GUI から起動したアプリの PATH はログインシェルの PATH と異なる（.zshrc が読まれない）ため、
 * PATH だけに頼らず既知のディレクトリも見る。
 */
import { accessSync, constants, existsSync } from 'fs';
import { delimiter, join } from 'path';
import { homedir } from 'os';
import * as vscode from 'vscode';

const WELL_KNOWN_DIRS = [
	join(homedir(), '.local', 'bin'),
	join(homedir(), '.claude', 'local'),
	'/opt/homebrew/bin',
	'/usr/local/bin'
];

function isExecutable(candidate: string): boolean {
	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** SDK が持っているプラットフォーム別パッケージ（同梱されていれば使う） */
function bundledBinary(): string | undefined {
	const pkg = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
	try {
		// require.resolve はパッケージの package.json 経由で探す（main が無いパッケージのため）
		const manifest = require.resolve(`${pkg}/package.json`);
		const dir = manifest.slice(0, manifest.length - '/package.json'.length);
		for (const name of ['claude', 'claude.exe']) {
			const candidate = join(dir, name);
			if (existsSync(candidate) && isExecutable(candidate)) {
				return candidate;
			}
		}
	} catch {
		// 同梱していない構成では解決できなくて当たり前
	}
	return undefined;
}

function fromSearchPaths(): string | undefined {
	const fromEnv = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
	for (const dir of [...fromEnv, ...WELL_KNOWN_DIRS]) {
		const candidate = join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
		if (existsSync(candidate) && isExecutable(candidate)) {
			return candidate;
		}
	}
	return undefined;
}

export function resolveClaudeExecutable(): string | undefined {
	const configured = vscode.workspace.getConfiguration('nimbus').get<string>('claudeCodeExecutable');
	if (configured && configured.trim().length > 0) {
		return configured.trim();
	}
	return bundledBinary() ?? fromSearchPaths();
}

/** 見つからなかったときに、利用者が次に何をすればよいかを示す */
export async function reportMissingExecutable(): Promise<void> {
	const OPEN_SETTINGS = '設定を開く';
	const choice = await vscode.window.showErrorMessage(
		'Nimbus: Claude Code が見つかりません。インストールするか、設定 nimbus.claudeCodeExecutable にパスを指定してください。',
		OPEN_SETTINGS
	);
	if (choice === OPEN_SETTINGS) {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'nimbus.claudeCodeExecutable');
	}
}
