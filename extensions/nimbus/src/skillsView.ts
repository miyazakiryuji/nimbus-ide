/**
 * いまのプロジェクトで使えるスキルの一覧。
 *
 * スキルは「あることを知らないと使えない」機能なので、探しに行かなくても
 * 常に見えている場所に置く。出どころ（プロジェクト／ユーザー／セッション）ごとに分ける。
 *
 * セッションが動いているときは、Claude が実際に読み込んだスキル（init メッセージ由来）も
 * 併せて出す。ディスク上に見つからないもの（プラグイン提供など）はここでしか分からない。
 */
import * as vscode from 'vscode';
import { discoverSkills, type Skill } from './core/skills';

type SkillNode =
	| { kind: 'group'; label: string; origin: string; skills: Skill[] }
	| { kind: 'skill'; skill: Skill }
	| { kind: 'hint'; label: string };

export class SkillsViewProvider implements vscode.TreeDataProvider<SkillNode> {
	private sessionSkills: string[] = [];
	private readonly emitter = new vscode.EventEmitter<SkillNode | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	refresh(): void {
		this.emitter.fire(undefined);
	}

	/** session-init が返したスキル名（Claude が実際に読み込んだもの） */
	setSessionSkills(names: readonly string[]): void {
		this.sessionSkills = [...names];
		this.refresh();
	}

	private discover(): Skill[] {
		const roots = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
		return discoverSkills(roots);
	}

	getTreeItem(node: SkillNode): vscode.TreeItem {
		if (node.kind === 'hint') {
			const item = new vscode.TreeItem(node.label);
			item.iconPath = new vscode.ThemeIcon('info');
			return item;
		}
		if (node.kind === 'group') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.description = String(node.skills.length);
			item.iconPath = new vscode.ThemeIcon('folder-library');
			return item;
		}
		const item = new vscode.TreeItem(node.skill.name);
		item.description = node.skill.description;
		item.tooltip = new vscode.MarkdownString(
			`**${node.skill.name}**\n\n${node.skill.description || '（説明なし）'}\n\n\`${node.skill.path}\``
		);
		item.iconPath = new vscode.ThemeIcon('lightbulb');
		item.contextValue = node.skill.path ? 'nimbusSkill' : 'nimbusSkillRemote';
		if (node.skill.path) {
			// クリックしたら SKILL.md をそのまま読める。中身を見れば使いどころが分かる
			item.command = {
				command: 'vscode.open',
				title: 'SKILL.md を開く',
				arguments: [vscode.Uri.file(node.skill.path)]
			};
		}
		return item;
	}

	getChildren(node?: SkillNode): SkillNode[] {
		if (node?.kind === 'group') {
			return node.skills.map((skill) => ({ kind: 'skill', skill }));
		}
		if (node) {
			return [];
		}

		const onDisk = this.discover();
		const groups: SkillNode[] = [];
		for (const [origin, label] of [
			['プロジェクト', 'プロジェクト'],
			['ユーザー', 'ユーザー']
		] as const) {
			const skills = onDisk.filter((s) => s.origin === origin);
			if (skills.length > 0) {
				groups.push({ kind: 'group', label, origin, skills });
			}
		}

		// ディスクに見つからないのにセッションが持っているもの（プラグイン提供など）
		const known = new Set(onDisk.map((s) => s.name));
		const fromSession = this.sessionSkills
			.filter((name) => !known.has(name))
			.map<Skill>((name) => ({ name, description: '', path: '', origin: 'セッション' }));
		if (fromSession.length > 0) {
			groups.push({ kind: 'group', label: 'セッション（プラグイン等）', origin: 'セッション', skills: fromSession });
		}

		if (groups.length === 0) {
			return [
				{ kind: 'hint', label: 'スキルがありません' },
				{ kind: 'hint', label: '.claude/skills/<名前>/SKILL.md に置くと、ここに出ます' }
			];
		}
		return groups;
	}
}
