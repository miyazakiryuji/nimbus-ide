/**
 * Claude Code の更新に気づいて知らせる（tasks.md T-094）。
 *
 * 新しいフックやツールが増えても、**増えたことに気づく機会が無い**。
 * init が毎回渡してくる一覧を覚えておけば、差分は機械的に出せる。
 *
 * 判断と文面は `core/versionWatch.ts`。
 */
import * as vscode from 'vscode';
import type { SessionInitEvent } from './events';
import {
	buildUpgradePrompt,
	describeUpgrade,
	diffCapabilities,
	isWorthTelling,
	type Capabilities
} from './core/versionWatch';

const STORAGE_KEY = 'nimbus.capabilities';

export interface VersionWatchDeps {
	send: (text: string) => void;
	log: (message: string) => void;
}

/** init のたびに覚え直し、増えていたら 1 回だけ知らせる */
export async function noticeUpgrade(
	storage: vscode.Memento,
	event: SessionInitEvent,
	deps: VersionWatchDeps
): Promise<void> {
	const now: Capabilities = {
		version: event.claudeCodeVersion,
		tools: [...event.tools],
		slashCommands: [...event.slashCommands],
		skills: [...event.skills],
		agents: [...(event.agents ?? [])]
	};
	const before = storage.get<Capabilities>(STORAGE_KEY);
	await storage.update(STORAGE_KEY, now);
	if (!before) {
		// 初回は比べる相手がいない。黙って覚えるだけ
		return;
	}

	const diff = diffCapabilities(before, now);
	if (!isWorthTelling(diff)) {
		return;
	}
	const summary = describeUpgrade(diff);
	deps.log(`[version] ${summary.split('\n').join(' / ')}`);

	const prompt = buildUpgradePrompt(diff);
	if (prompt.length === 0) {
		// バージョンだけ上がって、使えるものは変わっていない
		void vscode.window.showInformationMessage(`Nimbus: ${summary.split('\n')[0]}`);
		return;
	}
	const ASK = '使いどころを聞く';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ${summary.split('\n')[0]}`,
		{ detail: summary, modal: false },
		ASK
	);
	if (choice === ASK) {
		deps.send(prompt);
	}
}
