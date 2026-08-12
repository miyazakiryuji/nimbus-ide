/**
 * ホットリロード連携（tasks.md T-072）の実行側。
 *
 * ターンが終わって対象ファイルが変わっていたら、リロード → スクショ → セッションへ投入、
 * までを自動で回す。**回数の上限**と**既定オフ**は、暴走させないための最低条件。
 */
import { spawn } from 'child_process';
import { readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { toAttachment, type Attachment } from './core/attachments';
import {
	buildScreenshotCommand,
	reloadPrompt,
	shouldReload,
	type HotReloadConfig,
	DEFAULT_MAX_ROUNDS
} from './core/hotReload';

/** コマンド 1 本の待ち上限。返らないコマンドでセッションを止めない */
const COMMAND_TIMEOUT_MS = 60_000;

export function readHotReloadConfig(): HotReloadConfig {
	const config = vscode.workspace.getConfiguration('nimbus');
	return {
		enabled: config.get<boolean>('hotReload.enabled') === true,
		reloadCommand: config.get<string>('hotReload.reloadCommand') ?? '',
		screenshotCommand: config.get<string>('hotReload.screenshotCommand') ?? '',
		extensions: config.get<string[]>('hotReload.extensions') ?? [],
		maxRounds: config.get<number>('hotReload.maxRounds') ?? DEFAULT_MAX_ROUNDS
	};
}

/** シェル 1 本を走らせる。出力は診断のために返すだけで、判断には使わない */
function run(command: string, cwd: string): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		// ここは利用者が設定に書いたコマンドなので shell を通す（`|` や `>` を書けるようにする）
		const child = spawn(command, { cwd, shell: true });
		let output = '';
		const timer = setTimeout(() => {
			child.kill();
			resolve({ ok: false, output: `${output}\n（${COMMAND_TIMEOUT_MS / 1000} 秒で打ち切りました）` });
		}, COMMAND_TIMEOUT_MS);
		child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
		child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
		child.on('error', (error) => {
			clearTimeout(timer);
			resolve({ ok: false, output: `${output}\n${error.message}` });
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ ok: code === 0, output });
		});
	});
}

export interface ReloadOutcome {
	sent: boolean;
	/** 送らなかったときの理由（ログに出す） */
	reason?: string;
	prompt?: string;
	attachment?: Attachment;
}

/**
 * リロードして 1 枚撮り、送れる形にして返す。
 * 送信そのものは呼び出し側（`extension.ts`）が行う — 送信経路は 1 本に保ちたいので。
 */
export async function captureAfterReload(
	config: HotReloadConfig,
	changedFiles: readonly string[],
	roundsSoFar: number,
	cwd: string,
	log: (message: string) => void
): Promise<ReloadOutcome> {
	const decision = shouldReload(config, changedFiles, roundsSoFar);
	if (!decision.run) {
		return { sent: false, reason: decision.reason };
	}

	if (config.reloadCommand.trim()) {
		const reload = await run(config.reloadCommand, cwd);
		log(`[hot-reload] リロード: ${reload.ok ? '成功' : '失敗'}`);
		if (!reload.ok) {
			// リロードできていない画面を撮っても意味がない
			return { sent: false, reason: 'reload-failed' };
		}
	}

	const path = join(tmpdir(), `nimbus-shot-${Date.now()}.png`);
	const shot = await run(buildScreenshotCommand(config.screenshotCommand, path), cwd);
	if (!shot.ok) {
		log(`[hot-reload] スクショに失敗: ${shot.output.trim().slice(0, 200)}`);
		return { sent: false, reason: 'screenshot-failed' };
	}

	try {
		const bytes = await readFile(path);
		const result = toAttachment('reload.png', bytes, (raw) => Buffer.from(raw).toString('base64'));
		if (!result.ok) {
			log(`[hot-reload] 撮れた画像を送れません: ${result.reason}`);
			return { sent: false, reason: 'invalid-image' };
		}
		return {
			sent: true,
			prompt: reloadPrompt(roundsSoFar + 1, Math.max(1, config.maxRounds)),
			attachment: result.attachment
		};
	} catch (error) {
		log(`[hot-reload] 画像を読めません: ${error instanceof Error ? error.message : String(error)}`);
		return { sent: false, reason: 'unreadable' };
	} finally {
		// 一時ファイルは残さない
		await unlink(path).catch(() => undefined);
	}
}
