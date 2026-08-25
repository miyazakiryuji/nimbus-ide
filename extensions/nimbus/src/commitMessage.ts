/**
 * コミットメッセージを自動で作る（tasks.md T-305 / 型は T-309）。
 *
 * 置き場所は SCM の入力欄（`scm/inputBox`・標準の「Generate Commit Message」と同じ場所。
 * Copilot を外しているのでこの口は空いている）。
 *
 * 約束:
 * - **材料は `git diff --staged` だけ。勝手に `git add` しない** —
 *   並行セッションでは他人の変更を巻き込む。空なら「先に組んでください」と言って終わる
 * - **作ったものは入力欄に入れるだけ。** コミットも push もしない（人が読んでから）
 * - 本文は必ずサニタイザを通す（公開リポジトリに資格情報・個人情報を載せない）
 * - 生成の前に「いまの型」を見せ、押す前に直せる（T-309）
 *
 * 型の判定と指示文の組み立ては `core/commitMessage.ts`（VS Code 非依存・単体テスト済み）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { isAbsolute, join } from 'path';
import * as vscode from 'vscode';
import { pickWorkspaceRoot } from './workspaceRoots';
import { oneShot } from './oneShot';
import type { SessionManager } from './session/SessionManager';
import {
	buildCommitPrompt,
	cleanGeneratedMessage,
	describeStyle,
	detectCommitStyle,
	detectLanguage,
	truncateDiff,
	type CommitStyle
} from './core/commitMessage';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
	return stdout;
}

/** vscode.git 拡張の、使うぶんだけの形 */
interface GitRepositoryLike {
	rootUri: vscode.Uri;
	inputBox: { value: string };
}

/** SCM の入力欄。git 拡張が無い環境（切られている等）では undefined */
function findScmInputBox(cwd: string): GitRepositoryLike | undefined {
	const extension = vscode.extensions.getExtension<{ getAPI(version: 1): { repositories: GitRepositoryLike[] } }>(
		'vscode.git'
	);
	const api = extension?.isActive ? extension.exports.getAPI(1) : undefined;
	if (!api) {
		return undefined;
	}
	return (
		api.repositories.find((repository) => cwd.startsWith(repository.rootUri.fsPath)) ?? api.repositories[0]
	);
}

/** `git config commit.template` の中身。無ければ undefined */
async function readTemplate(cwd: string): Promise<string | undefined> {
	let path = '';
	try {
		path = (await git(cwd, ['config', '--get', 'commit.template'])).trim();
	} catch {
		return undefined;
	}
	if (!path) {
		return undefined;
	}
	const resolved = path.startsWith('~') ? join(homedir(), path.slice(1)) : isAbsolute(path) ? path : join(cwd, path);
	try {
		return readFileSync(resolved, 'utf8');
	} catch {
		return undefined;
	}
}

export interface CommitMessageDeps {
	sessions: SessionManager;
	sanitize: (text: string) => string;
	log: (message: string) => void;
}

export async function generateCommitMessage(deps: CommitMessageDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const cwd = folder.uri.fsPath;

	// **staged だけ**を材料にする。空なら生成しない（勝手に add しない）
	let staged: string;
	try {
		staged = await git(cwd, ['diff', '--staged']);
	} catch (error) {
		void vscode.window.showErrorMessage(
			`Nimbus: git を読めませんでした: ${error instanceof Error ? error.message : String(error)}`
		);
		return;
	}
	if (staged.trim().length === 0) {
		void vscode.window.showInformationMessage(
			'Nimbus: ステージが空です。先にコミットする変更を組んでください（「コミットの分けかたを提案」で束を組めます）。'
		);
		return;
	}

	const stat = await git(cwd, ['diff', '--staged', '--stat']).catch(() => '');
	const subjects = (await git(cwd, ['log', '--format=%s', '-30']).catch(() => ''))
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const template = await readTemplate(cwd);

	const config = vscode.workspace.getConfiguration('nimbus');
	const styleSetting = config.get<string>('commit.style') ?? 'auto';
	const detected = detectCommitStyle(subjects);
	const preferred: CommitStyle =
		styleSetting === 'repo' || styleSetting === 'conventional' || styleSetting === 'template'
			? styleSetting
			: detected.style;

	// **生成の前に「いまの型」を見せる**（T-309）。違えば押す前に直せる
	const evidence =
		detected.counts.total > 0
			? `過去 ${detected.counts.total} 件のうち Conventional が ${detected.counts.conventional} 件`
			: '過去のコミットがありません';
	const items: { label: string; description: string; style: CommitStyle }[] = [];
	const entry = (style: CommitStyle): { label: string; description: string; style: CommitStyle } => ({
		label: describeStyle(style),
		description:
			style === preferred
				? `いまの型（${styleSetting === 'auto' ? evidence : '設定 nimbus.commit.style'}）`
				: '',
		style
	});
	items.push(entry(preferred));
	for (const style of ['repo', 'conventional', 'template'] as const) {
		if (style !== preferred && (style !== 'template' || template !== undefined)) {
			items.push(entry(style));
		}
	}
	const picked = await vscode.window.showQuickPick(items, {
		title: 'Nimbus: どの型でコミットメッセージを書きますか',
		placeHolder: '設定 nimbus.commit.style で固定できます'
	});
	if (!picked) {
		return;
	}

	const languageSetting = config.get<string>('commit.language') ?? 'auto';
	const language = languageSetting === 'ja' || languageSetting === 'en' ? languageSetting : detectLanguage(subjects);
	const truncated = truncateDiff(staged);
	const prompt = buildCommitPrompt({
		diff: truncated.text,
		stat,
		style: picked.style,
		recentSubjects: subjects,
		template,
		language,
		subjectMax: config.get<number>('commit.subjectMax') ?? 72,
		body: config.get<boolean>('commit.body') ?? true,
		coAuthor: false
	});

	// 軽いモデルで足りる仕事（T-291 と同じ考えかた）。設定で変えられる
	const model = (config.get<string>('commit.model') ?? 'haiku').trim();
	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.SourceControl, title: 'コミットメッセージを作っています…' },
		async () => {
			const first = await oneShot(deps.sessions, { cwd, prompt, model: model || undefined });
			if (first.text.trim().length > 0) {
				return first;
			}
			// 指定モデルが環境に無い（Bedrock / Vertex など）と空で返ることがある。既定のモデルでやり直す
			deps.log(`[commit] モデル ${model || '(既定)'} で生成できず。既定のモデルで再試行します`);
			return oneShot(deps.sessions, { cwd, prompt });
		}
	);

	let message = cleanGeneratedMessage(result.text);
	if (message.length === 0) {
		void vscode.window.showWarningMessage('Nimbus: コミットメッセージを生成できませんでした。');
		return;
	}
	if (config.get<boolean>('commit.coAuthor') ?? false) {
		message = `${message}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`;
	}
	// 公開リポジトリに載る文なので、入力欄に入れる直前に必ず伏せる
	message = deps.sanitize(message);

	const repository = findScmInputBox(cwd);
	if (repository) {
		repository.inputBox.value = message;
		await vscode.commands.executeCommand('workbench.view.scm');
		deps.log(`[commit] メッセージを入力欄に入れました（$${(result.costUsd ?? 0).toFixed(4)}）`);
		if (truncated.truncated) {
			void vscode.window.showInformationMessage(
				'Nimbus: 変更が大きいため、一部のファイルは要約だけを材料にしました。読んでから直してください。'
			);
		}
	} else {
		// git 拡張が居ない。作ったものを捨てない
		await vscode.env.clipboard.writeText(message);
		void vscode.window.showInformationMessage(
			'Nimbus: SCM の入力欄が見つからないため、コミットメッセージをクリップボードに入れました。'
		);
	}
}
