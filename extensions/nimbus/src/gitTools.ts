/**
 * Git をエージェントの口にする（tasks.md T-307）。
 *
 * 素の `git` は Bash で打てる。**ここに足す価値は「Nimbus の作法を型にする」ことだけ**:
 *
 * - `git_status` — 自分が組んだ束と、作業ツリー（他のセッションのものかもしれない）を
 *   **分けて**返す。素の `git status` はこの区別を教えてくれない
 * - `git_stage` — **パス名指しのみ**。`-A` / `.` は受け付けない
 * - `git_commit` — メッセージがリポジトリの型（T-309）に合っているかを検査してから組む
 * - `git_sync` — `pull --rebase` → `push`。安全装置は画面のボタン（T-306）と同じ `gitSync.ts`
 *
 * **履歴を壊す操作は口に出さない**（force push / `reset --hard` / `stash` / `checkout --`）。
 *
 * 承認: `git_status` だけが読み取り専用の素通し。**書く 3 つは承認カードに回る**
 * （`core/secrets.ts` の `NIMBUS_WRITE_TOOLS` — `mcp__nimbus_` の素通しから外してある）。
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { resolveWorkspaceRoot } from './workspaceRoots';
import { parsePorcelainStatus, renderStatus, validateStagePaths } from './core/gitTools';
import { checkMessageStyle, detectCommitStyle } from './core/commitMessage';
import { describeSyncOutcome, performSync } from './gitSync';

export const GIT_SERVER_NAME = 'nimbus_git';

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await run('git', args, { cwd, maxBuffer: 32 * 1024 * 1024 });
	return stdout;
}

/** 1 つの文字列を MCP の返しの形にする */
function reply(text: string, isError = false): { content: { type: 'text'; text: string }[]; isError?: boolean } {
	return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) };
}

function repoRoot(): string | undefined {
	return resolveWorkspaceRoot()?.uri.fsPath;
}

const SERVER_INSTRUCTIONS = [
	'Nimbus が動いているリポジトリの git 操作。**並行セッションの作法**が入っている:',
	'- 作業ツリーの unstaged な変更は他のセッションのものかもしれない。**自分が書いたと分かるファイルだけ** git_stage で名指しする',
	'- まとめ指定（-A / .）や、他人の変更を消す操作（stash / checkout -- / reset --hard）はここには無い。使わない',
	'- コミットの前に git_status で束を確かめる。押し上げは git_sync（pull --rebase → push）'
].join('\n');

function defineTools() {
	return [
		tool(
			'git_status',
			'いまのブランチと変更の一覧。自分が組んだ束（staged）と、作業ツリーの変更（他のセッションのものかもしれない）を分けて返す。',
			{},
			async () => {
				const cwd = repoRoot();
				if (!cwd) {
					return reply('フォルダが開かれていません。', true);
				}
				try {
					const text = await git(cwd, ['status', '--porcelain', '-b']);
					return reply(renderStatus(parsePorcelainStatus(text)));
				} catch (error) {
					return reply(`git status を読めませんでした: ${error instanceof Error ? error.message : String(error)}`, true);
				}
			}
		),
		tool(
			'git_stage',
			'名指ししたファイルだけをコミットの束に入れる（git add -- <paths>）。まとめ指定（-A / .）は受け付けない。他のセッションの変更を巻き込まないため、自分が書いたと分かるファイルだけを渡すこと。',
			{
				file_paths: z.array(z.string()).describe('リポジトリからの相対パス。名指しのみ')
			},
			async (input) => {
				const cwd = repoRoot();
				if (!cwd) {
					return reply('フォルダが開かれていません。', true);
				}
				const checked = validateStagePaths(input.file_paths);
				if ('error' in checked) {
					return reply(checked.error, true);
				}
				try {
					await git(cwd, ['add', '--', ...checked.ok]);
					const status = parsePorcelainStatus(await git(cwd, ['status', '--porcelain', '-b']));
					return reply(`${checked.ok.length} 件を束に入れました。\n\n${renderStatus(status)}`);
				} catch (error) {
					return reply(`git add に失敗しました: ${error instanceof Error ? error.message : String(error)}`, true);
				}
			}
		),
		tool(
			'git_commit',
			'いま組んである束（staged）をコミットする。メッセージがこのリポジトリの型に合っているかを先に検査し、合っていなければ理由を返す（-a は無い。束は git_stage で組む）。',
			{
				message: z.string().describe('コミットメッセージ全文（1 行目＋空行＋本文）')
			},
			async (input) => {
				const cwd = repoRoot();
				if (!cwd) {
					return reply('フォルダが開かれていません。', true);
				}
				try {
					const status = parsePorcelainStatus(await git(cwd, ['status', '--porcelain', '-b']));
					if (status.conflicted.length > 0) {
						return reply(`競合が残っています（${status.conflicted.join(' / ')}）。解決してからにしてください。`, true);
					}
					if (status.staged.length === 0) {
						return reply('束（staged）が空です。先に git_stage でコミットするファイルを名指ししてください。', true);
					}
					// メッセージの型の検査（T-309 と同じ物差し）
					const configuration = vscode.workspace.getConfiguration('nimbus');
					const styleSetting = configuration.get<string>('commit.style') ?? 'auto';
					const subjects = (await git(cwd, ['log', '--format=%s', '-30']).catch(() => ''))
						.split('\n')
						.map((line) => line.trim())
						.filter(Boolean);
					const style =
						styleSetting === 'repo' || styleSetting === 'conventional' || styleSetting === 'template'
							? styleSetting
							: detectCommitStyle(subjects).style;
					const problem = checkMessageStyle(
						input.message,
						style,
						configuration.get<number>('commit.subjectMax') ?? 72
					);
					if (problem) {
						return reply(
							`メッセージが型に合っていません: ${problem}\n最近の 1 行目（手本）:\n${subjects
								.slice(0, 5)
								.map((subject) => `- ${subject}`)
								.join('\n')}`,
							true
						);
					}
					await git(cwd, ['commit', '-m', input.message]);
					const head = (await git(cwd, ['log', '--format=%h %s', '-1'])).trim();
					return reply(`コミットしました: ${head}\n押し上げるときは git_sync を使ってください。`);
				} catch (error) {
					return reply(`git commit に失敗しました: ${error instanceof Error ? error.message : String(error)}`, true);
				}
			}
		),
		tool(
			'git_sync',
			'取り込んで押し上げる（git pull --rebase → git push）。作業ツリーに未コミットの変更が残っていれば何もせず止まる（autostash はしない）。競合したら rebase を止めたまま返す。',
			{},
			async () => {
				const cwd = repoRoot();
				if (!cwd) {
					return reply('フォルダが開かれていません。', true);
				}
				const outcome = await performSync(cwd);
				return reply(describeSyncOutcome(outcome), outcome.kind !== 'ok');
			}
		)
	];
}

let cached: McpSdkServerConfigWithInstance | undefined;

/** セッションに渡す MCP サーバー。1 つ作って全セッションで共有する */
export function gitMcpServer(): McpSdkServerConfigWithInstance {
	cached ??= createSdkMcpServer({
		name: GIT_SERVER_NAME,
		version: '0.1.0',
		instructions: SERVER_INSTRUCTIONS,
		tools: defineTools(),
		alwaysLoad: true
	});
	return cached;
}
