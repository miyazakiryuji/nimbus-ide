/**
 * シミュレータを操作して、動くところまで確かめさせる（tasks.md T-073）。
 *
 * 「実装できました」と「画面が動きました」の間には距離がある。
 *
 * - **画面を撮って渡す** — 文字の説明より、撮った画面 1 枚のほうが早い
 * - **流れをテストに起こす** — 一度 `integration_test` になれば、次からは人が押さなくていい
 *
 * 判定と文面は `core/simulator.ts`。取得は `xcrun simctl` に任せる（macOS のみ）。
 */
import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	buildScreenshotPrompt,
	describeFlow,
	parseDeviceList,
	parseFlow,
	renderFlowTest,
	usableDevices,
	type SimDevice
} from './core/simulator';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface SimulatorDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

function run(command: string, args: string[], cwd?: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim() || error.message));
				return;
			}
			resolve(stdout);
		});
	});
}

async function pickDevice(deps: SimulatorDeps): Promise<SimDevice | undefined> {
	if (process.platform !== 'darwin') {
		void vscode.window.showInformationMessage('Nimbus: iOS シミュレータは macOS でのみ使えます。');
		return undefined;
	}
	let devices: SimDevice[];
	try {
		devices = usableDevices(parseDeviceList(await run('xcrun', ['simctl', 'list', 'devices', '--json'])));
	} catch (error) {
		deps.log(`[sim] 端末を取れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showInformationMessage(
			'Nimbus: シミュレータの一覧を取得できませんでした（Xcode のコマンドラインツールが要ります）。'
		);
		return undefined;
	}
	if (devices.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 使えるシミュレータがありません。');
		return undefined;
	}
	const picked = await vscode.window.showQuickPick(
		devices.map((device) => ({
			label: device.name,
			description: `${device.runtime}${device.state === 'Booted' ? '・起動中' : ''}`,
			device
		})),
		{ title: 'どのシミュレータを使いますか' }
	);
	return picked?.device;
}

/** 画面を撮って、見えているものを言わせる */
export async function captureSimulator(deps: SimulatorDeps): Promise<void> {
	const device = await pickDevice(deps);
	if (!device) {
		return;
	}

	if (device.state !== 'Booted') {
		try {
			await run('xcrun', ['simctl', 'boot', device.udid]);
		} catch (error) {
			deps.log(`[sim] 起動できませんでした: ${error instanceof Error ? error.message : String(error)}`);
			void vscode.window.showErrorMessage('Nimbus: シミュレータを起動できませんでした。');
			return;
		}
	}

	const file = path.join(os.tmpdir(), `nimbus-sim-${device.udid}.png`);
	try {
		await run('xcrun', ['simctl', 'io', device.udid, 'screenshot', file]);
	} catch (error) {
		deps.log(`[sim] 撮れませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: 画面を撮れませんでした。');
		return;
	}
	deps.log(`[sim] ${device.name} を撮りました: ${file}`);

	const question = await vscode.window.showInputBox({
		title: '何を確かめますか',
		placeHolder: '例: ログインボタンは押せる状態ですか',
		prompt: '空でも進めます（見えているものを書かせます）'
	});
	deps.send(buildScreenshotPrompt(file, question || undefined));
}

/** 人が書いた流れを `integration_test` の下書きにする */
export async function writeFlowTest(deps: SimulatorDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const editor = vscode.window.activeTextEditor;
	const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
	const text =
		parseFlow(selected).length > 0
			? selected
			: ((await vscode.window.showInputBox({
					title: '確かめたい流れを書いてください',
					placeHolder: 'タップ: ログイン / 入力: メール = a@example.com / 確かめる: ホーム',
					prompt: '1 手順 1 行。頭の言葉が無ければ「押す」と読みます'
				})) ?? '');
	const steps = parseFlow(text.replace(/\s*\/\s*/g, '\n'));
	if (steps.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 手順を読み取れませんでした。');
		return;
	}

	const title = await vscode.window.showInputBox({
		title: 'このテストの名前',
		value: steps.map((step) => step.target).join('→').slice(0, 40)
	});
	if (title === undefined) {
		return;
	}

	deps.log(`[sim] ${describeFlow(steps).split('\n')[0]}`);
	const document = await vscode.workspace.openTextDocument({
		language: 'dart',
		content: renderFlowTest(steps, title)
	});
	await vscode.window.showTextDocument(document, { preview: false });
	void vscode.window.showInformationMessage(
		'Nimbus: 下書きを出しました（`integration_test/` に保存して、起点の呼び出しを足してください）。'
	);
}
