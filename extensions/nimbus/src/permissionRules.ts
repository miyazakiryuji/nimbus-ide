/**
 * 承認ルールを画面から編集する（tasks.md T-028）。
 *
 * T-038 で「今後この種類は常に許可」を設定に残せるようにした。残せるようになると、
 * 次に要るのは**溜まったものを見返して減らす**手段になる。許可は増える一方だと危ない。
 *
 * 一覧には「そのルールが何を許すのか」を日本語で添える（`core/permissionRules.ts`）。
 * 書式だけ見せても、範囲を読み違えたまま溜めていくことになるため。
 */
import * as vscode from 'vscode';
import { checkNewRule, tidyRules, viewRules } from './core/permissionRules';

const SETTING = 'permissions.alwaysAllow';

function read(): string[] {
	return vscode.workspace.getConfiguration('nimbus').get<string[]>(SETTING) ?? [];
}

async function write(rules: string[]): Promise<void> {
	const config = vscode.workspace.getConfiguration('nimbus');
	const target = vscode.workspace.workspaceFolders?.length
		? vscode.ConfigurationTarget.Workspace
		: vscode.ConfigurationTarget.Global;
	await config.update(SETTING, rules, target);
}

interface RuleItem extends vscode.QuickPickItem {
	/** 消す対象。追加や片付けの行では undefined */
	value?: string;
	action?: 'add' | 'tidy';
}

/** ルールを 1 つ足す。点検の結果は出すが、足すかどうかは人が決める */
async function addRule(existing: readonly string[]): Promise<void> {
	const text = await vscode.window.showInputBox({
		title: 'Nimbus: 確認せずに許可するルールを足す',
		prompt: 'Read / Write(*.md) / Bash(npm test) のように書きます',
		placeHolder: 'Bash(npm test)',
		validateInput: (value) => {
			if (!value.trim()) {
				return undefined;
			}
			const check = checkNewRule(value, existing);
			return check.valid ? undefined : check.warnings[0];
		}
	});
	if (!text?.trim()) {
		return;
	}
	const check = checkNewRule(text.trim(), existing);
	if (!check.valid) {
		return;
	}
	const ADD = '足す';
	const answer = await vscode.window.showWarningMessage(
		check.explanation ?? text,
		{ modal: true, detail: check.warnings.join('\n') },
		ADD
	);
	if (answer === ADD) {
		await write([...existing, text.trim()]);
		void vscode.window.showInformationMessage(`Nimbus: ルールを足しました（${text.trim()}）。`);
	}
}

export async function editPermissionRules(): Promise<void> {
	for (;;) {
		const rules = read();
		const views = viewRules(rules);
		const items: RuleItem[] = views.map((view) => ({
			label: view.valid ? `$(pass) ${view.text}` : `$(error) ${view.text}`,
			description: view.coveredBy ? `より広い ${view.coveredBy} に含まれています` : undefined,
			detail: view.explanation ?? '書式が読めません（Read / Write(*.md) / Bash(npm test)）',
			value: view.text
		}));
		if (items.length === 0) {
			items.push({ label: '$(info) ルールはまだありません', detail: '承認のときに「今後この種類は常に許可」を選ぶと、ここに溜まります' });
		}
		items.push({ label: '$(add) ルールを足す', action: 'add' });
		if (views.some((view) => !view.valid || view.coveredBy)) {
			items.push({
				label: '$(clear-all) 読めないもの・重なっているものを片付ける',
				detail: '書式が読めないルールと、より広いルールに含まれているルールを取り除きます',
				action: 'tidy'
			});
		}

		const picked = await vscode.window.showQuickPick(items, {
			title: `Nimbus: 確認せずに許可するルール（${rules.length} 件）`,
			placeHolder: '消したいルールを選ぶと確認します'
		});
		if (!picked) {
			return;
		}
		if (picked.action === 'add') {
			await addRule(rules);
			continue;
		}
		if (picked.action === 'tidy') {
			const tidied = tidyRules(rules);
			await write(tidied);
			void vscode.window.showInformationMessage(`Nimbus: ${rules.length - tidied.length} 件を片付けました。`);
			continue;
		}
		if (!picked.value) {
			continue;
		}
		const REMOVE = '消す';
		const answer = await vscode.window.showWarningMessage(
			`「${picked.value}」を消します。`,
			{ modal: true, detail: '以後この種類は、実行のたびに確認するようになります。' },
			REMOVE
		);
		if (answer === REMOVE) {
			await write(rules.filter((rule) => rule !== picked.value));
		}
	}
}
