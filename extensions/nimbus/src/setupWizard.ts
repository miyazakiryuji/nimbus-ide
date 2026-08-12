/**
 * 使い始めを案内する（tasks.md T-203 / T-204）。
 *
 * **勝手に設定しない。** 何を入れるかを見せて、選ばれたものだけを書く。
 * 「気づいたら設定が変わっていた」がいちばん信用を失う。
 */
import * as vscode from 'vscode';
import { guessPreset, PRESETS, renderSetup, setupSteps, type Preset } from './core/presets';
import { appendSection } from './core/claudeMdDoc';
import { resolveClaudeExecutable } from './claudeExecutable';

async function exists(uri: vscode.Uri): Promise<boolean> {
	try {
		await vscode.workspace.fs.stat(uri);
		return true;
	} catch {
		return false;
	}
}

async function applyPreset(preset: Preset, folder: vscode.WorkspaceFolder): Promise<void> {
	const config = vscode.workspace.getConfiguration();
	for (const [key, value] of Object.entries(preset.settings)) {
		await config.update(key, value, vscode.ConfigurationTarget.Workspace);
	}

	if (preset.claudeMdSections.length === 0) {
		return;
	}
	const uri = vscode.Uri.joinPath(folder.uri, 'CLAUDE.md');
	let content = '';
	if (await exists(uri)) {
		content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8');
	}
	for (const section of preset.claudeMdSections) {
		content = appendSection(content, section.heading, section.body).content;
	}
	await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
}

export async function runSetupWizard(): Promise<void> {
	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const marker = await vscode.workspace.findFiles(
		new vscode.RelativePattern(folder, '{pubspec.yaml,go.mod,Package.swift,package.json}'),
		'**/node_modules/**',
		5
	);
	const guessed = guessPreset(marker.map((uri) => vscode.workspace.asRelativePath(uri)));

	const state = {
		hasClaudeCode: Boolean(resolveClaudeExecutable()),
		hasClaudeMd: await exists(vscode.Uri.joinPath(folder.uri, 'CLAUDE.md')),
		isTrusted: vscode.workspace.isTrusted,
		hasPreset: vscode.workspace.getConfiguration().inspect('nimbus.build.command')?.workspaceValue !== undefined
	};

	const document = await vscode.workspace.openTextDocument({
		content: renderSetup(setupSteps(state)),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });

	const picked = await vscode.window.showQuickPick(
		PRESETS.map((preset) => ({
			label: preset.label,
			description: preset.id === guessed ? '（このリポジトリに合いそうです）' : undefined,
			detail: preset.detail,
			preset
		})).sort((a, b) => Number(b.preset.id === guessed) - Number(a.preset.id === guessed)),
		{ title: 'Nimbus: どの形で始めますか（あとから変えられます）' }
	);
	if (!picked) {
		return;
	}

	// 何が入るかを見せてから書く。黙って設定を変えない
	const summary = [
		'次のものを入れます:',
		'',
		...Object.entries(picked.preset.settings).map(([key, value]) => `・${key} = ${JSON.stringify(value)}`),
		...picked.preset.claudeMdSections.map((section) => `・CLAUDE.md に「${section.heading}」を足す`)
	].join('\n');

	const apply = '入れる';
	const answer = await vscode.window.showInformationMessage(summary, { modal: true }, apply);
	if (answer !== apply) {
		return;
	}

	await applyPreset(picked.preset, folder);
	void vscode.window.showInformationMessage(
		`Nimbus: ${picked.preset.label} の設定を入れました。合わなければ設定から変えられます。`
	);
}
