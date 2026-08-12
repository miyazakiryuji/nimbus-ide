/**
 * Claude Code の更新に気づく（tasks.md T-094）。
 *
 * 新しいフックやツールが増えても、**増えたことに気づく機会が無い**。
 * 知らないまま古いやり方を続けるのが、いちばんもったいない。
 *
 * バージョン番号だけでは「何が増えたか」は分からないが、
 * **init が毎回渡してくるツール・コマンド・スキルの一覧**を覚えておけば、差分は機械的に出せる。
 * 推測ではなく、実際に増えたものだけを言える。
 *
 * VS Code に依存しない。
 */

export interface Capabilities {
	version: string;
	tools: string[];
	slashCommands: string[];
	skills: string[];
	agents: string[];
}

export interface CapabilityDiff {
	previousVersion: string;
	version: string;
	addedTools: string[];
	addedCommands: string[];
	addedSkills: string[];
	addedAgents: string[];
}

function added(before: readonly string[], after: readonly string[]): string[] {
	const known = new Set(before);
	return after.filter((entry) => !known.has(entry)).sort();
}

/** 前回との差分。**増えたものだけ**を見る（消えたものは騒ぐ理由が無い） */
export function diffCapabilities(before: Capabilities, after: Capabilities): CapabilityDiff {
	return {
		previousVersion: before.version,
		version: after.version,
		addedTools: added(before.tools, after.tools),
		addedCommands: added(before.slashCommands, after.slashCommands),
		addedSkills: added(before.skills, after.skills),
		addedAgents: added(before.agents, after.agents)
	};
}

/** 知らせる価値があるか。バージョンが同じで、増えたものも無ければ黙る */
export function isWorthTelling(diff: CapabilityDiff): boolean {
	return (
		diff.previousVersion !== diff.version ||
		diff.addedTools.length + diff.addedCommands.length + diff.addedSkills.length + diff.addedAgents.length > 0
	);
}

/** 通知に出す文。**増えたものだけ**を名指しする */
export function describeUpgrade(diff: CapabilityDiff): string {
	const parts: string[] = [];
	if (diff.previousVersion !== diff.version) {
		parts.push(`Claude Code が ${diff.previousVersion} → ${diff.version} に上がりました`);
	} else {
		parts.push('使えるものが増えています');
	}
	const sections: [string, string[]][] = [
		['ツール', diff.addedTools],
		['スラッシュコマンド', diff.addedCommands],
		['スキル', diff.addedSkills],
		['サブエージェント', diff.addedAgents]
	];
	for (const [label, entries] of sections) {
		if (entries.length > 0) {
			parts.push(`  ${label}: ${entries.join(', ')}`);
		}
	}
	return parts.join('\n');
}

/**
 * セッションへ投入する文。
 * **知らないものは知らないと言わせる** — 学習時点より新しい機能について、
 * それらしい説明を作られると、いちばん困る。
 */
export function buildUpgradePrompt(diff: CapabilityDiff): string {
	const entries = [
		...diff.addedTools.map((name) => `- ツール: ${name}`),
		...diff.addedCommands.map((name) => `- コマンド: ${name}`),
		...diff.addedSkills.map((name) => `- スキル: ${name}`),
		...diff.addedAgents.map((name) => `- サブエージェント: ${name}`)
	];
	if (entries.length === 0) {
		return '';
	}
	return [
		`Claude Code が ${diff.previousVersion} → ${diff.version} に上がり、次のものが使えるようになりました。`,
		'',
		...entries,
		'',
		'このプロジェクトで**実際に役立ちそうなもの**があれば、使いどころを教えてください。',
		'**知らないものは「知らない」と言ってください。** 推測で説明を作らないでください。'
	].join('\n');
}
