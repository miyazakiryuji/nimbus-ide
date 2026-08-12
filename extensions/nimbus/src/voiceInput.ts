/**
 * 声で指示する（tasks.md T-055）。
 *
 * 録るのは `ffmpeg`、文字にするのは手元の書き起こしツール。
 * **どちらも外に送らない。** 無ければ、入れかたを出して終わる。
 */
import { execFile } from 'child_process';
import { mkdtemp, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import {
	buildRecordArgs,
	buildTranscribeArgs,
	cleanTranscript,
	confirmationMessage,
	defaultDevice,
	describeMissing,
	ENGINES,
	parseAudioDevices,
	pickEngine,
	riskyWords,
	type AudioDevice
} from './core/voiceInput';

export interface VoiceInputDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function run(command: string, args: string[]): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		execFile(command, args, { maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) =>
			resolve({ ok: !error, output: stdout + stderr })
		);
	});
}

async function has(command: string): Promise<boolean> {
	return (await run('which', [command])).ok;
}

async function listDevices(): Promise<AudioDevice[]> {
	// `-list_devices` は必ず失敗で終わる（入力が無いため）。出力だけを見る
	const result = await run('ffmpeg', ['-f', 'avfoundation', '-list_devices', 'true', '-i', '']);
	return parseAudioDevices(result.output);
}

/** 書き起こしツールが吐いた `.txt` を読む。名前はツールによって違うので、拡張子で拾う */
async function readTranscript(directory: string): Promise<string> {
	const files = (await readdir(directory)).filter((name) => name.endsWith('.txt'));
	if (files.length === 0) {
		return '';
	}
	return cleanTranscript(await readFile(join(directory, files[0]), 'utf8'));
}

export async function dictateInstruction(deps: VoiceInputDeps): Promise<void> {
	const hasFfmpeg = await has('ffmpeg');
	const available: string[] = [];
	for (const engine of ENGINES) {
		if (await has(engine.command)) {
			available.push(engine.command);
		}
	}
	const engine = pickEngine(available);

	if (!hasFfmpeg || !engine) {
		const document = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: describeMissing(hasFfmpeg)
		});
		await vscode.window.showTextDocument(document, { preview: true });
		return;
	}

	const devices = await listDevices();
	if (devices.length === 0) {
		void vscode.window.showErrorMessage('Nimbus: 音を録れる装置が見つかりませんでした。');
		return;
	}

	// 既定はマイク。仮想オーディオを既定にすると、喋っても何も録れない
	const suggested = defaultDevice(devices);
	const picked =
		devices.length === 1
			? devices[0]
			: (
				await vscode.window.showQuickPick(
					devices.map((device) => ({
						label: device.name,
						description: device === suggested ? 'いつもの' : undefined,
						device
					})),
					{ title: 'どこから録りますか', placeHolder: suggested?.name }
				)
			)?.device;
	if (!picked) {
		return;
	}

	const seconds = 15;
	const directory = await mkdtemp(join(tmpdir(), 'nimbus-voice-'));
	const audioPath = join(directory, 'voice.wav');

	const recorded = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Nimbus: 聞いています（${seconds} 秒）`, cancellable: false },
		() => run('ffmpeg', buildRecordArgs({ seconds, device: picked.index, outputPath: audioPath }))
	);
	if (!recorded.ok) {
		void vscode.window.showErrorMessage(
			`Nimbus: 録れませんでした。${picked.name} を使える設定になっているか確かめてください。`
		);
		return;
	}

	const transcribed = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Nimbus: 文字にしています（${engine.label}）` },
		() =>
			run(
				engine.command,
				buildTranscribeArgs(engine, {
					audioPath,
					outputDir: directory,
					modelPath: vscode.workspace.getConfiguration('nimbus').get<string>('voice.modelPath')
				})
			)
	);
	if (!transcribed.ok) {
		void vscode.window.showErrorMessage(`Nimbus: 文字にできませんでした。${transcribed.output.split('\n')[0]}`);
		return;
	}

	const text = await readTranscript(directory);
	deps.log(`[voice] ${picked.name} / ${engine.label} → ${text.length} 文字`);

	if (text.length === 0) {
		void vscode.window.showWarningMessage(confirmationMessage(''));
		return;
	}

	// **確認なしに送らない。** 聞き間違いは必ず起きる
	const risky = riskyWords(text);
	const answer = await vscode.window.showInformationMessage(
		confirmationMessage(text),
		{ modal: risky.length > 0 },
		'送る',
		'直してから送る'
	);
	if (answer === '送る') {
		deps.send(text);
		return;
	}
	if (answer === '直してから送る') {
		const edited = await vscode.window.showInputBox({ title: '直して送る', value: text });
		if (edited?.trim()) {
			deps.send(edited.trim());
		}
	}
}
