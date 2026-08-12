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
import { findRepeatedInstructions, type RepeatedInstruction } from './core/repeatedInstructions';
import { readRecentTranscripts } from './core/transcriptFiles';
import {
	appendBullet,
	appendSection,
	classifyOrigin,
	displayLabel,
	estimateTokens,
	lintClaudeMd,
	parseSections,
	SECTION_TEMPLATES,
	type ClaudeMdFinding,
	type ClaudeMdOrigin,
	type ClaudeMdSection
} from './core/claudeMdDoc';

type ClaudeMdNode =
	| { kind: 'repeated'; items: RepeatedInstruction[] }
	| { kind: 'repeatedItem'; item: RepeatedInstruction }
	| { kind: 'file'; path: string; label: string; origin: ClaudeMdOrigin }
	| { kind: 'section'; path: string; section: ClaudeMdSection }
	| { kind: 'findings'; path: string; findings: ClaudeMdFinding[] }
	| { kind: 'finding'; path: string; finding: ClaudeMdFinding }
	| { kind: 'hint'; label: string };

const ORIGIN_LABEL: Record<ClaudeMdOrigin, string> = {
	project: 'プロジェクト',
	ancestor: '親フォルダから継承',
	user: 'ユーザー設定'
};

/** 直近いくつの記録を見るか（昔の癖ではなく「いま毎回言っていること」を出したい） */
const RECENT_TRANSCRIPTS = 20;

/** 1 ファイルの読み込み上限。ツリーを開くだけで固まらせないための保険 */
const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

/** 提案の上限。多すぎると読まれない */
const MAX_SUGGESTIONS = 5;

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

	/**
	 * 過去のセッションで何度も言っている指示を拾う（T-041）。
	 *
	 * 読むのは Claude Code 本体が残している記録（`~/.claude/projects/…`）。
	 * 直近のものだけ見る — 昔の癖ではなく「いま毎回言っていること」を出したいのと、
	 * ツリーを開くたびに全履歴を舐めると重いため。
	 */
	private repeatedInstructions(): RepeatedInstruction[] {
		const root = this.workspaceRoot();
		if (!root) {
			return [];
		}
		const entries = readRecentTranscripts(root, this.home, {
			limit: RECENT_TRANSCRIPTS,
			maxBytes: MAX_TRANSCRIPT_BYTES
		});
		const messages = entries.filter((entry) => entry.role === 'user').map((entry) => entry.text);
		return findRepeatedInstructions(messages).slice(0, MAX_SUGGESTIONS);
	}

	getTreeItem(node: ClaudeMdNode): vscode.TreeItem {
		if (node.kind === 'repeated') {
			const item = new vscode.TreeItem(`何度も言っている指示（${node.items.length} 件）`, vscode.TreeItemCollapsibleState.Collapsed);
			item.iconPath = new vscode.ThemeIcon('comment-discussion');
			item.tooltip = '毎回言っているなら、CLAUDE.md に書けば言わずに済みます';
			return item;
		}
		if (node.kind === 'repeatedItem') {
			const item = new vscode.TreeItem(node.item.text);
			item.description = `${node.item.count} 回`;
			item.iconPath = new vscode.ThemeIcon('lightbulb-autofix');
			item.contextValue = 'nimbusRepeatedInstruction';
			item.tooltip = new vscode.MarkdownString(
				`直近のセッションで **${node.item.count} 回**言っています。\n\nCLAUDE.md に書いておくと、毎回言わずに済みます。`
			);
			return item;
		}
		if (node.kind === 'hint') {
			const item = new vscode.TreeItem(node.label);
			item.iconPath = new vscode.ThemeIcon('info');
			return item;
		}
		if (node.kind === 'findings') {
			const item = new vscode.TreeItem(`${node.findings.length} 件の指摘`, vscode.TreeItemCollapsibleState.Collapsed);
			item.iconPath = new vscode.ThemeIcon('warning');
			item.tooltip = '重複・空の節・長さ。毎ターン読まれる場所なので、太ると全部に効きます';
			return item;
		}
		if (node.kind === 'finding') {
			const item = new vscode.TreeItem(node.finding.message);
			item.iconPath = new vscode.ThemeIcon(node.finding.kind === 'too-long' ? 'flame' : 'issue-opened');
			item.command = {
				command: 'vscode.open',
				title: '該当箇所を開く',
				arguments: [
					vscode.Uri.file(node.path),
					{ selection: new vscode.Range(node.finding.line, 0, node.finding.line, 0) }
				]
			};
			return item;
		}
		if (node.kind === 'file') {
			const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
			// 「どの階層か」と「どれだけ食っているか」を並べる。どちらも直す判断に要る
			const tokens = estimateTokens(readText(node.path));
			item.description = `${ORIGIN_LABEL[node.origin]} · 約 ${tokens} トークン`;
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
		if (node?.kind === 'findings') {
			return node.findings.map((finding) => ({ kind: 'finding', path: node.path, finding }));
		}
		if (node?.kind === 'repeated') {
			return node.items.map((item) => ({ kind: 'repeatedItem', item }));
		}
		if (node?.kind === 'file') {
			const content = readText(node.path);
			const sections = parseSections(content);
			if (sections.length === 0) {
				return [{ kind: 'hint', label: '（中身がありません）' }];
			}
			const findings = lintClaudeMd(content);
			// 指摘は節より先に出す。開いた瞬間に「太っている」と分かるほうが直る
			const head: ClaudeMdNode[] = findings.length > 0
				? [{ kind: 'findings', path: node.path, findings }]
				: [];
			return [...head, ...sections.map((section): ClaudeMdNode => ({ kind: 'section', path: node.path, section }))];
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
		const repeated = this.repeatedInstructions();
		const suggestions: ClaudeMdNode[] = repeated.length > 0 ? [{ kind: 'repeated', items: repeated }] : [];
		return [...files.map((file): ClaudeMdNode => ({ kind: 'file', ...file })), ...suggestions];
	}
}

/** 「毎回言っている指示」を移す先の節。1 つに溜めて、見出しが増えないようにする */
const REPEATED_HEADING = '毎回の指示';

/**
 * 何度も言っている指示を CLAUDE.md へ移す（T-234）。
 *
 * 見せるだけでは結局書かれないので、その場で足せるようにする。ただし**足す前に文言を直せる**
 * ようにしてある。話し言葉のまま入れると、指示としては曖昧なことが多いため。
 */
export async function promoteInstruction(view: ClaudeMdViewProvider, text: string): Promise<void> {
	const target = view.files().find((f) => f.origin === 'project');
	const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	const path = target?.path ?? (root ? vscode.Uri.joinPath(vscode.Uri.file(root), 'CLAUDE.md').fsPath : undefined);
	if (!path) {
		void vscode.window.showInformationMessage('Nimbus: フォルダを開いてから実行してください。');
		return;
	}

	const edited = await vscode.window.showInputBox({
		title: 'Nimbus: CLAUDE.md に足す',
		prompt: `「${REPEATED_HEADING}」の節に箇条書きとして足します`,
		value: text,
		validateInput: (value) => (value.trim().length === 0 ? '空にはできません' : undefined)
	});
	if (edited === undefined) {
		return;
	}

	const before = readText(path);
	const { content, line } = appendBullet(before, REPEATED_HEADING, edited);
	if (content === before) {
		void vscode.window.showInformationMessage('Nimbus: 同じ内容が既に書かれています。その行を開きます。');
	} else {
		writeFileSync(path, content, 'utf8');
	}
	view.refresh();

	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
	const editor = await vscode.window.showTextDocument(document);
	const position = new vscode.Position(line, 0);
	editor.selection = new vscode.Selection(position, position);
	editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
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
