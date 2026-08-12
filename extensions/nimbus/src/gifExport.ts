/**
 * 作業の様子を GIF にする（tasks.md T-223）。
 *
 * フレームの撮り方は、ホットリロードと**同じ設定**を使う
 * （`nimbus.hotReload.screenshotCommand`）。撮り方を 2 つ持たない。
 * 組み立ては `ffmpeg` に任せ、無ければ**撮ったものを残して**手順を出す。
 */
import { execFile } from 'child_process';
import { mkdtemp, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import { buildScreenshotCommand } from './core/hotReload';
import {
	buildGifArgs,
	describeSize,
	estimateBytes,
	manualInstructions,
	planCapture,
	renderPlan,
	type CapturePlan
} from './core/gifExport';

export interface GifExportDeps {
	log: (message: string) => void;
}

function run(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(command, { shell: true, maxBuffer: 8 * 1024 * 1024 }, (error) => resolve(!error));
	});
}

function runTool(command: string, args: string[]): Promise<boolean> {
	return new Promise((resolve) => {
		execFile(command, args, { maxBuffer: 32 * 1024 * 1024 }, (error) => resolve(!error));
	});
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 何秒ぶんを、どれくらいの滑らかさで撮るか */
async function askPlan(): Promise<CapturePlan | undefined> {
	const seconds = await vscode.window.showQuickPick(
		[
			{ label: '10 秒', seconds: 10 },
			{ label: '20 秒', seconds: 20 },
			{ label: '30 秒', seconds: 30 },
			{ label: '60 秒', seconds: 60 }
		],
		{ title: '何秒ぶん撮りますか' }
	);
	if (!seconds) {
		return undefined;
	}
	const fps = await vscode.window.showQuickPick(
		[
			{ label: 'なめらか（10 fps）', fps: 10 },
			{ label: 'ふつう（5 fps）', fps: 5 },
			{ label: '軽い（2 fps）', fps: 2 }
		],
		{ title: 'どれくらい細かく撮りますか' }
	);
	return fps ? planCapture(seconds.seconds, fps.fps) : undefined;
}

export async function exportGif(deps: GifExportDeps): Promise<void> {
	const template = vscode.workspace.getConfiguration('nimbus').get<string>('hotReload.screenshotCommand', '').trim();
	if (!template) {
		const answer = await vscode.window.showWarningMessage(
			'Nimbus: 画面の撮り方が決まっていません。`nimbus.hotReload.screenshotCommand` に、画像を `{file}` へ書き出すコマンドを入れてください。',
			'設定を開く'
		);
		if (answer === '設定を開く') {
			await vscode.commands.executeCommand('workbench.action.openSettings', 'nimbus.hotReload.screenshotCommand');
		}
		return;
	}

	const plan = await askPlan();
	if (!plan) {
		return;
	}

	const width = vscode.workspace.getConfiguration('nimbus').get<number>('gif.width', 800);
	const start = await vscode.window.showInformationMessage(
		`Nimbus: ${renderPlan(plan, width)}`,
		{ modal: false, detail: '撮っている間、この画面を触って構いません。' },
		'撮る'
	);
	if (start !== '撮る') {
		return;
	}

	const directory = await mkdtemp(join(tmpdir(), 'nimbus-gif-'));
	let taken = 0;

	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: 撮っています', cancellable: true },
		async (progress, token) => {
			for (let i = 0; i < plan.frames; i++) {
				if (token.isCancellationRequested) {
					break;
				}
				const file = join(directory, `f-${String(i).padStart(4, '0')}.png`);
				if (await run(buildScreenshotCommand(template, file))) {
					taken++;
				}
				progress.report({
					message: `${taken} / ${plan.frames} 枚`,
					increment: 100 / plan.frames
				});
				await wait(plan.intervalMs);
			}
		}
	);

	// 撮れた枚数で答える（頼まれた枚数ではなく）
	const files = (await readdir(directory)).filter((name) => name.endsWith('.png'));
	if (files.length === 0) {
		void vscode.window.showErrorMessage(
			'Nimbus: 1 枚も撮れませんでした。`screenshotCommand` が画像を `{file}` に書き出しているか確かめてください。'
		);
		return;
	}

	const outputPath = join(directory, 'nimbus.gif');
	const options = {
		inputPattern: join(directory, 'f-%04d.png'),
		outputPath,
		fps: Math.round(1000 / plan.intervalMs),
		width
	};

	const built = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: GIF にしています' },
		() => runTool('ffmpeg', buildGifArgs(options))
	);
	deps.log(`[gif] ${files.length} 枚 → ${built ? outputPath : 'ffmpeg なし'}`);

	if (!built) {
		// 撮ったものは消さない。入れたあとに、同じ手順で作れる
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: manualInstructions(options)
		});
		await vscode.window.showTextDocument(document, { preview: true });
		return;
	}

	const answer = await vscode.window.showInformationMessage(
		`Nimbus: ${files.length} 枚から GIF を作りました（${describeSize(estimateBytes(files.length, width))} 前後）。`,
		'保存する',
		'場所を開く'
	);
	if (answer === '保存する') {
		const target = await vscode.window.showSaveDialog({
			title: 'GIF を保存する',
			filters: { GIF: ['gif'] },
			saveLabel: '保存'
		});
		if (target) {
			await vscode.workspace.fs.copy(vscode.Uri.file(outputPath), target, { overwrite: true });
		}
	} else if (answer === '場所を開く') {
		await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(outputPath));
	}
}
