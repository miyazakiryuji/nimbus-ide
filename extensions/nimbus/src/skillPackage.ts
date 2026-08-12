/**
 * 自分のスキルを、人が入れられる形にする（tasks.md T-070）。
 *
 * **作るのはフォルダまで。** GitHub に置くかどうかは人が決める
 * （公開は取り消せないので、機械が決めてよいことではない）。
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import * as vscode from 'vscode';
import { inspectRedactions } from './core/shareSession';
import { discoverSkills } from './core/skills';
import {
	describePlan,
	planPackage,
	renderMarketplaceJson,
	renderReadme,
	type PackagePlan
} from './core/skillPackage';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface SkillPackageDeps {
	log: (message: string) => void;
}

/** 中身を読む。読めないものは空として扱う（読めないことを理由に止めない） */
function readSkillText(path: string): string {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
}

async function writeAll(target: vscode.Uri, plan: PackagePlan, repository: string | undefined): Promise<void> {
	const encoder = new TextEncoder();
	await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '.claude-plugin'));
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(target, '.claude-plugin', 'marketplace.json'),
		encoder.encode(renderMarketplaceJson(plan))
	);
	await vscode.workspace.fs.writeFile(
		vscode.Uri.joinPath(target, 'README.md'),
		encoder.encode(renderReadme(plan, repository))
	);
	for (const file of plan.files) {
		await vscode.workspace.fs.copy(vscode.Uri.file(file.from), vscode.Uri.joinPath(target, file.to), {
			overwrite: true
		});
	}
}

export async function packageSkills(deps: SkillPackageDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}

	const skills = discoverSkills([folder.uri.fsPath]);
	if (skills.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 配れるスキルが見つかりませんでした。');
		return;
	}

	const name = await vscode.window.showInputBox({
		title: '配る名前（リポジトリ名になります）',
		value: `${folder.name}-skills`,
		validateInput: (value) => (/^[a-z0-9][a-z0-9-]*$/.test(value.trim()) ? undefined : '英小文字・数字・ハイフンで書いてください')
	});
	if (!name) {
		return;
	}

	const plan = planPackage(skills, {
		name: name.trim(),
		readSkill: (skill) => readSkillText(skill.path),
		inspect: (text) => inspectRedactions(text, homedir())
	});
	if (plan.marketplace.plugins.length === 0) {
		void vscode.window.showWarningMessage(`Nimbus: 入れられるスキルがありませんでした。\n${describePlan(plan)}`);
		return;
	}

	// 何が入って何が入らないかを、作る前に見せる
	const preview = await vscode.workspace.openTextDocument({ language: 'markdown', content: describePlan(plan) });
	await vscode.window.showTextDocument(preview, { preview: true });

	const answer = await vscode.window.showInformationMessage(
		`Nimbus: ${plan.marketplace.plugins.length} 個を配れる形にします。`,
		{
			modal: false,
			detail:
				plan.warnings.length > 0
					? '出す前に見たほうがよいものがあります（左の一覧）。作るのはフォルダまでで、公開はしません。'
					: '作るのはフォルダまでで、公開はしません。'
		},
		'場所を選んで作る'
	);
	if (answer !== '場所を選んで作る') {
		return;
	}

	const chosen = await vscode.window.showOpenDialog({
		title: '作る場所を選ぶ',
		canSelectFolders: true,
		canSelectFiles: false,
		openLabel: 'ここに作る'
	});
	const target = chosen?.[0];
	if (!target) {
		return;
	}

	const repository = await vscode.window.showInputBox({
		title: '置き場所（分かっていれば）',
		prompt: 'README の入れかたに使います。あとで書き足しても構いません',
		placeHolder: 'owner/repo'
	});

	await writeAll(target, plan, repository?.trim() || undefined);
	deps.log(`[skills] ${plan.marketplace.plugins.length} 個を ${target.fsPath} に出しました`);

	const opened = await vscode.window.showInformationMessage(
		`Nimbus: ${plan.marketplace.plugins.length} 個を出しました。git に入れて push すれば、そのまま配れます。`,
		'場所を開く'
	);
	if (opened === '場所を開く') {
		await vscode.commands.executeCommand('revealFileInOS', target);
	}
}
