/**
 * セッションの始め方・分けかた・戻しかた（tasks.md T-036 / T-148 / T-150）。
 *
 * - テンプレート（T-148）: よく使う開始条件を保存して呼び出す
 * - 分岐（T-036）: いまのセッションから A 案・B 案を並列に走らせる
 * - 復元（T-150）: 過去のセッションを再開する
 *
 * 3 つとも「どうやって始めるか」の話なので 1 か所にまとめてある。
 */
import { readdir, readFile, stat } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import * as vscode from 'vscode';
import type { Memento } from 'vscode';
import { readSessionMeta, type TranscriptSessionMeta } from './core/transcripts';
import {
	applyPreset,
	BUILTIN_PRESETS,
	branchTitle,
	describePreset,
	removePreset,
	upsertPreset,
	type SessionPreset
} from './core/sessionPresets';

const PRESET_KEY = 'nimbus.sessionPresets';
/** 復元の候補として見に行く記録の数。多すぎると選べない */
const RESTORE_LIMIT = 30;

export function loadPresets(storage: Memento): SessionPreset[] {
	const saved = storage.get<SessionPreset[]>(PRESET_KEY, []);
	// 出荷時のものは常に出す。利用者が同名で保存したら、そちらが勝つ
	const names = new Set(saved.map((preset) => preset.name));
	return [...saved, ...BUILTIN_PRESETS.filter((preset) => !names.has(preset.name))];
}

export interface StartFromPreset {
	prompt: string;
	permissionMode?: SessionPreset['permissionMode'];
	model?: string;
}

/**
 * テンプレートを選び、入力を受けて、送る文を組み立てる（T-148）。
 * @returns 開始条件。取りやめたら undefined
 */
export async function pickPreset(storage: Memento): Promise<StartFromPreset | undefined> {
	const presets = loadPresets(storage);
	const MANAGE = '$(gear) テンプレートを管理';
	const chosen = await vscode.window.showQuickPick(
		[
			...presets.map((preset) => ({ label: preset.name, description: describePreset(preset), preset })),
			{ label: MANAGE, description: '', preset: undefined as SessionPreset | undefined }
		],
		{ title: 'Nimbus: テンプレートから始める' }
	);
	if (!chosen) {
		return undefined;
	}
	if (!chosen.preset) {
		await managePresets(storage);
		return undefined;
	}
	const input = await vscode.window.showInputBox({
		title: `Nimbus: ${chosen.preset.name}`,
		prompt: '指示を書く',
		placeHolder: 'テンプレートの {input} に入ります'
	});
	if (input === undefined) {
		return undefined;
	}
	return {
		prompt: applyPreset(chosen.preset, input),
		permissionMode: chosen.preset.permissionMode,
		model: chosen.preset.model
	};
}

/** テンプレートの追加・削除。出荷時のものは消せない（消すと戻せなくなる） */
export async function managePresets(storage: Memento): Promise<void> {
	const saved = storage.get<SessionPreset[]>(PRESET_KEY, []);
	const ADD = '$(add) 新しいテンプレート';
	const chosen = await vscode.window.showQuickPick(
		[ADD, ...saved.map((preset) => preset.name)].map((label) => ({ label })),
		{ title: 'Nimbus: テンプレートの管理（選ぶと削除）' }
	);
	if (!chosen) {
		return;
	}
	if (chosen.label !== ADD) {
		await storage.update(PRESET_KEY, removePreset(saved, chosen.label));
		return;
	}
	const name = await vscode.window.showInputBox({ title: '名前', placeHolder: '例: 調査（書き換えない）' });
	if (!name) {
		return;
	}
	const prompt = await vscode.window.showInputBox({
		title: '指示のひな形',
		prompt: '{input} が呼び出し時の入力に置き換わります',
		value: '{input}'
	});
	if (prompt === undefined) {
		return;
	}
	const permissionMode = await vscode.window.showQuickPick(['default', 'plan', 'acceptEdits'], { title: '権限モード' });
	await storage.update(
		PRESET_KEY,
		upsertPreset(saved, { name, prompt, permissionMode: permissionMode as SessionPreset['permissionMode'] })
	);
}

export interface BranchPlan {
	claudeSessionId: string;
	titles: string[];
	prompts: string[];
}

/**
 * 分岐の計画を立てる（T-036）。
 * いまのセッションを**再開したもの**を案の数だけ作り、それぞれ別の指示を送る。
 * 同じ地点から始まるので、比べているのは「指示の違い」だけになる。
 */
export async function planBranch(claudeSessionId: string | undefined, baseTitle: string): Promise<BranchPlan | undefined> {
	if (!claudeSessionId) {
		void vscode.window.showInformationMessage('Nimbus: 分岐できるセッションがありません（まだ開始していません）。');
		return undefined;
	}
	const count = await vscode.window.showQuickPick(['2', '3'], {
		title: 'Nimbus: いくつの案を並べますか',
		placeHolder: '同じ地点から並列に走らせます'
	});
	if (!count) {
		return undefined;
	}
	const prompts: string[] = [];
	const titles: string[] = [];
	for (let index = 0; index < Number(count); index++) {
		const label = branchTitle(baseTitle, index);
		const prompt = await vscode.window.showInputBox({
			title: `Nimbus: ${label}`,
			prompt: 'この案でやってほしいこと',
			placeHolder: '例: 既存の設計を活かして最小の変更で直す'
		});
		if (!prompt) {
			// 途中でやめたら、それまでの案も作らない（半端に走り出すほうが困る）
			return undefined;
		}
		titles.push(label);
		prompts.push(prompt);
	}
	return { claudeSessionId, titles, prompts };
}

export interface RestorableSession extends TranscriptSessionMeta {
	mtime: number;
}

/**
 * 復元できる過去のセッションを集める（T-150）。
 *
 * **バックアップは Claude Code 本体が既に取っている**（`~/.claude/projects/**`）。
 * Nimbus が別に保存すると二重管理になるので、ここは「読んで、選んで、再開する」だけにする。
 */
export async function listRestorable(cwd: string): Promise<RestorableSession[]> {
	const root = join(homedir(), '.claude', 'projects');
	let dirs: string[];
	try {
		dirs = await readdir(root);
	} catch {
		return [];
	}
	// 作業ディレクトリが一致する記録だけを候補にする（別プロジェクトの続きは出さない）
	const found: RestorableSession[] = [];
	for (const dir of dirs) {
		let entries: string[];
		try {
			entries = await readdir(join(root, dir));
		} catch {
			continue;
		}
		for (const entry of entries.filter((name) => name.endsWith('.jsonl'))) {
			const path = join(root, dir, entry);
			try {
				const info = await stat(path);
				const meta: TranscriptSessionMeta = { sessionId: entry.replace(/\.jsonl$/, '') };
				// 見出しだけ欲しいので、先頭のほうだけ読めば足りる
				const head = (await readFile(path, 'utf8')).split('\n').slice(0, 200);
				for (const line of head) {
					readSessionMeta(line, meta);
				}
				if (meta.cwd === cwd) {
					found.push({ ...meta, mtime: info.mtimeMs });
				}
			} catch {
				continue;
			}
		}
	}
	return found.sort((a, b) => b.mtime - a.mtime).slice(0, RESTORE_LIMIT);
}

/** 復元するセッションを選ばせる（T-150） */
export async function pickRestorable(cwd: string): Promise<RestorableSession | undefined> {
	const sessions = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Nimbus: 再開できるセッションを探しています' },
		() => listRestorable(cwd)
	);
	if (sessions.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: このフォルダで再開できるセッションは見つかりませんでした。');
		return undefined;
	}
	const chosen = await vscode.window.showQuickPick(
		sessions.map((session) => ({
			label: session.title ?? `セッション ${session.sessionId.slice(0, 8)}`,
			description: session.gitBranch ?? '',
			detail: [session.endedAt?.slice(0, 16).replace('T', ' '), session.sessionId].filter(Boolean).join(' · '),
			session
		})),
		{ title: 'Nimbus: どのセッションを再開しますか', matchOnDetail: true }
	);
	return chosen?.session;
}
