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
import { delimiter, isAbsolute, join } from 'path';
import { homedir } from 'os';
import * as vscode from 'vscode';
import { missingExecutableGuidance } from './core/remoteGuidance';

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
		const path = configured.trim();
		/*
		 * **絶対パスのときだけ、実在と実行権を確かめる**（T-350・敵対的試験 adv-07）。
		 * 以前はそのまま返していたので、打ち間違えた設定が「準備は揃っています」を通り抜け、
		 * 送信前チェックも素通りして SDK の英語エラーまで進んでいた。
		 * `claude` のような**コマンド名**は PATH 解決に任せる（そこまで奪わない）ので、
		 * 見るのは絶対パスのときだけ。他の 2 経路（同梱・PATH 探索）は元から確かめている
		 */
		if (isAbsolute(path) && !(existsSync(path) && isExecutable(path))) {
			return undefined;
		}
		return path;
	}
	return bundledBinary() ?? fromSearchPaths();
}

/**
 * 見つからなかったときに、利用者が次に何をすればよいかを示す。
 *
 * **リモートに繋いでいるときは言い分ける（T-084）。** Nimbus の拡張は
 * 既定でリモート側で動くので、手元に入れても直らない。
 * そこを言わないと、入れる場所を間違えたまま何度も入れ直すことになる。
 */
export async function reportMissingExecutable(): Promise<void> {
	const OPEN_SETTINGS = '設定を開く';
	const guidance = missingExecutableGuidance(vscode.env.remoteName);
	// リモートのときだけモーダルにする。入れる場所を間違えたまま進ませたくない
	const choice = guidance.detail
		? await vscode.window.showErrorMessage(
			guidance.message,
			{ modal: true, detail: guidance.detail },
			OPEN_SETTINGS
		)
		: await vscode.window.showErrorMessage(guidance.message, OPEN_SETTINGS);
	if (choice === OPEN_SETTINGS) {
		await vscode.commands.executeCommand('workbench.action.openSettings', 'nimbus.claudeCodeExecutable');
	}
}
