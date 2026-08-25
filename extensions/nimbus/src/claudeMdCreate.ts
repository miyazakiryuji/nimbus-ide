/**
 * ボタン一つで CLAUDE.md を作る（tasks.md T-319）。
 *
 * 「節を足す」（T-008）は 1 節ずつで、**白紙から書き始めるのが重い**。
 * テンプレートを選ばせて足場を作る。約束は 3 つ:
 *
 * - **既にある CLAUDE.md を上書きしない**（追記か別名を提案する）
 * - どの階層に作るかを聞く（プロジェクト直下か、全プロジェクト共通の `~/.claude/` か）
 * - 作ったら開いて人に読ませる（書いた気にさせて終わらせない）
 *
 * 中身は**数えた事実**で埋める（`conventions.ts`・実在する scripts）。分からないところは
 * TODO のコメントとして残す — 推測を書き込まない。文面は `core/claudeMdTemplates.ts`。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import * as vscode from 'vscode';
import { collectSamples } from './conventions';
import { detectConventions, renderConventions } from './core/conventions';
import {
	renderCustomTemplate,
	renderTemplate,
	suggestTemplate,
	templateChoices,
	type TemplateFacts
} from './core/claudeMdTemplates';
import { pickWorkspaceRoot } from './workspaceRoots';

/** 実在する走らせ方を拾う（推測しない。読めた分だけ） */
function collectRunCommands(root: string): string[] {
	const commands: string[] = [];
	try {
		const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
			scripts?: Record<string, string>;
		};
		for (const name of Object.keys(manifest.scripts ?? {})) {
			commands.push(`npm run ${name}`);
		}
	} catch {
		// package.json が無い・読めない
	}
	if (existsSync(join(root, 'pubspec.yaml'))) {
		commands.push('flutter run', 'flutter test');
	}
	if (existsSync(join(root, 'Makefile'))) {
		commands.push('make');
	}
	return commands;
}

export interface CreateClaudeMdDeps {
	log: (message: string) => void;
	/** 作り終えたら一覧を出し直す */
	refresh: () => void;
}

export async function createClaudeMd(deps: CreateClaudeMdDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const root = folder.uri.fsPath;

	// どの階層に作るか（親から継承しているときに、どこへ書くかで意味が変わる）
	const PROJECT = 'このプロジェクト（リポジトリ直下）';
	const USER = 'すべてのプロジェクト共通（~/.claude/CLAUDE.md）';
	const layer = await vscode.window.showQuickPick(
		[
			{ label: PROJECT, description: join(folder.name, 'CLAUDE.md') },
			{ label: USER, description: '個人の好み（言語・作法）はこちら' }
		],
		{ title: 'Nimbus: どの階層に作りますか' }
	);
	if (!layer) {
		return;
	}
	const targetPath = layer.label === USER ? join(homedir(), '.claude', 'CLAUDE.md') : join(root, 'CLAUDE.md');

	// 事実を数える（プロジェクト向けのときだけ。ユーザー共通に個別リポジトリの癖は書かない）
	const facts: TemplateFacts = { projectName: layer.label === USER ? '毎回の指示（共通）' : folder.name };
	if (layer.label === PROJECT) {
		const samples = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Window, title: 'このリポジトリの書き方を数えています…' },
			() => collectSamples(folder)
		);
		if (samples.length > 0) {
			facts.conventions = renderConventions(detectConventions(samples));
		}
		const runCommands = collectRunCommands(root);
		if (runCommands.length > 0) {
			facts.runCommands = runCommands;
		}
		facts.flutter = existsSync(join(root, 'pubspec.yaml'));
	}

	// テンプレートを選ぶ（勧めを先頭に。利用者の設定ぶんも並べる）
	const suggested = suggestTemplate(facts);
	const custom = vscode.workspace
		.getConfiguration('nimbus')
		.get<Record<string, string>>('claudeMd.templates', {});
	const builtin = templateChoices()
		.sort((a, b) => (a.id === suggested ? -1 : b.id === suggested ? 1 : 0))
		.map((choice) => ({
			label: choice.label,
			description: `${choice.id === suggested ? 'おすすめ · ' : ''}${choice.description}`,
			id: choice.id as string,
			body: undefined as string | undefined
		}));
	const extras = Object.entries(custom).map(([label, body]) => ({
		label,
		description: '自分のテンプレート（nimbus.claudeMd.templates）',
		id: 'custom',
		body
	}));
	const picked = await vscode.window.showQuickPick([...builtin, ...extras], {
		title: 'Nimbus: どのテンプレートで作りますか'
	});
	if (!picked) {
		return;
	}
	const body =
		picked.body !== undefined
			? renderCustomTemplate(picked.body, facts)
			: renderTemplate(picked.id as ReturnType<typeof suggestTemplate>, facts);

	// **上書きしない。** 既にあるなら、追記か別名を選ばせる
	let finalPath = targetPath;
	let content = body;
	if (existsSync(targetPath)) {
		const APPEND = '既存の末尾に追記する';
		const NEW_NAME = '別名（CLAUDE.md.new）で作って見比べる';
		const how = await vscode.window.showQuickPick([APPEND, NEW_NAME], {
			title: `Nimbus: ${vscode.workspace.asRelativePath(targetPath, false)} は既にあります`,
			placeHolder: '上書きはしません'
		});
		if (!how) {
			return;
		}
		if (how === APPEND) {
			const existing = readFileSync(targetPath, 'utf8');
			// 見出し（# 名前）は重ねない。テンプレートの中身だけを足す
			const withoutTitle = body.replace(/^# .*\n\n?/, '');
			content = `${existing.replace(/\n*$/, '')}\n\n${withoutTitle}`;
		} else {
			finalPath = `${targetPath}.new`;
		}
	}

	mkdirSync(dirname(finalPath), { recursive: true });
	writeFileSync(finalPath, content);
	deps.log(`[claude-md] 作りました: ${finalPath}`);
	deps.refresh();

	// 作ったら開いて読ませる。TODO を残したまま使うと、指示が浮く
	const document = await vscode.workspace.openTextDocument(vscode.Uri.file(finalPath));
	await vscode.window.showTextDocument(document, { preview: false });
	if (finalPath.endsWith('.new')) {
		void vscode.window.showInformationMessage(
			'Nimbus: 別名（.new）で作りました。見比べて、良ければ中身を移してください。'
		);
	}
}
