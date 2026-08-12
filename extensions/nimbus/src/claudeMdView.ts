/**
 * CLAUDE.md のタブ。
 *
 * CLAUDE.md は毎セッション必ず読まれるのに、普段はただのテキストファイルで、
 * 「どの階層のものが効いていて、どこに何が書いてあるか」が見えない。
 * ここでは階層ごとに並べ、見出し単位で開けるようにする。
 *
 * 文脈ビュー（`contextView.ts`）が「いま何が渡っているか」を**見せる**場所なのに対し、
 * ここは**直す**場所。編集そのものは標準のエディタに任せる（自前のエディタは作らない）。
 */
import { readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import * as vscode from 'vscode';
import { findClaudeMdFiles } from './core/claudeMd';
import {
	appendSection,
	classifyOrigin,
	displayLabel,
	parseSections,
	SECTION_TEMPLATES,
	type ClaudeMdOrigin,
	type ClaudeMdSection
} from './core/claudeMdDoc';

type ClaudeMdNode =
	| { kind: 'file'; path: string; label: string; origin: ClaudeMdOrigin }
	| { kind: 'section'; path: string; section: ClaudeMdSection }
	| { kind: 'hint'; label: string };

const ORIGIN_LABEL: Record<ClaudeMdOrigin, string> = {
	project: 'プロジェクト',
	ancestor: '親フォルダから継承',
	user: 'ユーザー設定'
};

const ORIGIN_ICON: Record<ClaudeMdOrigin, string> = {
	project: 'root-folder',
	ancestor: 'folder-opened',
	user: 'account'
};

function readText(path: string): string {
	try {
		return readFileSync(path, 'utf8');
	} catch {
		return '';
	}
}

export class ClaudeMdViewProvider implements vscode.TreeDataProvider<ClaudeMdNode> {
	private readonly emitter = new vscode.EventEmitter<ClaudeMdNode | undefined>();
	readonly onDidChangeTreeData = this.emitter.event;

	constructor(private readonly home: string = homedir()) { }

	refresh(): void {
		this.emitter.fire(undefined);
	}

	private workspaceRoot(): string | undefined {
		return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	}

	/** 効いている CLAUDE.md を階層つきで集める */
	files(): { path: string; label: string; origin: ClaudeMdOrigin }[] {
		const root = this.workspaceRoot();
		return findClaudeMdFiles(root ?? process.cwd(), this.home).map((path) => ({
			path,
			label: displayLabel(path, root, this.home),
			origin: classifyOrigin(path, root, this.home)
		}));
	}

	getTreeItem(node: ClaudeMdNode): vscode.TreeItem {
		if (node.kind === 'hint') {
			const item = new vscode.TreeItem(node.label);
			item.iconPath = new vscode.ThemeIcon('info');
			return item;
		}
		if (node.kind === 'file') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			item.description = ORIGIN_LABEL[node.origin];
			item.tooltip = node.path;
			item.iconPath = new vscode.ThemeIcon(ORIGIN_ICON[node.origin]);
			item.contextValue = 'nimbusClaudeMdFile';
			item.resourceUri = vscode.Uri.file(node.path);
			item.command = {
				command: 'vscode.open',
				title: 'CLAUDE.md を開く',
				arguments: [vscode.Uri.file(node.path)]
			};
			return item;
		}
		const item = new vscode.TreeItem(node.section.title || '（前書き）');
		item.iconPath = new vscode.ThemeIcon('symbol-string');
		item.tooltip = new vscode.MarkdownString(node.section.body.slice(0, 400));
		// 見出しの行を開く。読むためではなく直すために来る場所なので、その行に着地させる
		item.command = {
			command: 'vscode.open',
			title: 'この節を開く',
			arguments: [
				vscode.Uri.file(node.path),
				{ selection: new vscode.Range(node.section.line, 0, node.section.line, 0) }
			]
		};
		return item;
	}

	getChildren(node?: ClaudeMdNode): ClaudeMdNode[] {
		if (node?.kind === 'file') {
			const sections = parseSections(readText(node.path));
			if (sections.length === 0) {
				return [{ kind: 'hint', label: '（中身がありません）' }];
			}
			return sections.map((section) => ({ kind: 'section', path: node.path, section }));
		}
		if (node) {
			return [];
		}
		const files = this.files();
		if (files.length === 0) {
			return [
				{ kind: 'hint', label: 'CLAUDE.md がありません（「節を足す」で作れます）' }
			];
		}
		return files.map((file) => ({ kind: 'file', ...file }));
	}
}

/**
 * 節を足す。
 *
 * 「何を書けばいいか分からない」まま CLAUDE.md が育たないのが一番もったいないので、
 * ひな形から選ばせる。足したらその行を開いて、すぐ書ける状態にする。
 */
export async function addClaudeMdSection(view: ClaudeMdViewProvider): Promise<void> {
	const files = view.files();
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const targets = files.length > 0
		? files.map((f) => ({ label: f.label, description: ORIGIN_LABEL[f.origin], path: f.path }))
		: root
			? [{ label: 'CLAUDE.md', description: '新しく作る', path: vscode.Uri.joinPath(vscode.Uri.file(root), 'CLAUDE.md').fsPath }]
			: [];
	if (targets.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const target = targets.length === 1
		? targets[0]
		: await vscode.window.showQuickPick(targets, { title: 'Nimbus: どの CLAUDE.md に足しますか' });
	if (!target) {
		return;
	}

	const picked = await vscode.window.showQuickPick(
		SECTION_TEMPLATES.map((t) => ({ label: t.heading, detail: t.description, template: t })),
		{ title: 'Nimbus: どの節を足しますか', matchOnDetail: true }
	);
	if (!picked) {
		return;
	}

	const before = readText(target.path);
	const { content, line } = appendSection(before, picked.template.heading, picked.template.body);
	if (content !== before) {
		writeFileSync(target.path, content, 'utf8');
	} else {
		void vscode.window.showInformationMessage(`Nimbus: 「${picked.template.heading}」は既にあります。その節を開きます。`);
	}
	view.refresh();

	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target.path));
	const editor = await vscode.window.showTextDocument(document);
	const position = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
