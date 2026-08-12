/**
 * 戻す道と、急ぐ道（tasks.md T-216 / T-144）。
 *
 * 出したあとで慌てて考えることを、**出す前に用意しておく**。
 * 障害の最中は判断力が落ちるので、そこで初めて「どうやって戻す？」を考えるのがいちばん危ない。
 *
 * この層が守っている 2 つのこと:
 *
 * 1. **戻らないものを「戻る」と言わない。** DB のマイグレーションや外部への通知は
 *    `git` では戻らない。戻せる部分と戻せない部分を分けて出す。
 *    嘘のロールバック手順は、手順が無いより悪い
 * 2. **急ぐときに省いてよいものと、絶対に省かないものを分ける。**
 *    「緊急だから」で落としていいのはレビューの待ち時間であって、テストと戻し口ではない
 *
 * **走らせない。** 出すのは手順とスクリプトの中身まで。実行は人が読んでから。
 *
 * VS Code に依存しない。
 */
import type { Commit } from './releaseNotes';

/** 戻す方法。どちらを選べるかは、出し方で決まる */
export type RollbackKind =
	/** 前のタグをもう一度出す。いちばん速く、履歴も汚れない */
	| 'redeploy'
	/** コミットを打ち消して出し直す。前のタグが無い／出し直せないとき */
	| 'revert';

export interface RollbackInput {
	/** いま出ている版（タグ名やコミット） */
	current: string;
	/** ひとつ前の版。無ければ `revert` しか選べない */
	previous?: string;
	/** `previous`..`current` のコミット */
	commits: readonly Commit[];
	/** `previous`..`current` で変わったファイル */
	changedFiles: readonly string[];
}

/** 戻らないもの。**戻せる前提で書かない**ためにここで名指しする */
export interface Irreversible {
	kind: 'migration' | 'data' | 'external';
	/** 気づいたきっかけ（ファイル名など） */
	evidence: string;
	note: string;
}

export interface RollbackPlan {
	kind: RollbackKind;
	current: string;
	previous?: string;
	/** 戻すと消える変更 */
	undone: Commit[];
	irreversible: Irreversible[];
}

const MIGRATION_HINTS = [/(^|\/)migrations?\//i, /(^|\/)db\/migrate\//i, /\.sql$/i, /(^|\/)prisma\/migrations\//i];
const DATA_HINTS = [/(^|\/)seeds?\//i, /(^|\/)fixtures?\//i];
const EXTERNAL_HINTS = [
	/(^|\/)(terraform|infra|deploy|k8s|kubernetes|helm)\//i,
	/(^|\/)\.github\/workflows\//i,
	/(^|\/)(firebase|firestore)\.(json|rules)$/i
];

/**
 * 戻らないものを名指しする。
 * **「たぶん大丈夫」は書かない** — 疑わしいものは挙げて、判断は人に渡す。
 */
export function findIrreversible(changedFiles: readonly string[]): Irreversible[] {
	const found: Irreversible[] = [];
	for (const file of changedFiles) {
		if (MIGRATION_HINTS.some((pattern) => pattern.test(file))) {
			found.push({
				kind: 'migration',
				evidence: file,
				note: 'コードを戻しても DB のスキーマは戻りません。down が書かれているかを先に見てください'
			});
		} else if (DATA_HINTS.some((pattern) => pattern.test(file))) {
			found.push({
				kind: 'data',
				evidence: file,
				note: '投入済みのデータは戻りません'
			});
		} else if (EXTERNAL_HINTS.some((pattern) => pattern.test(file))) {
			found.push({
				kind: 'external',
				evidence: file,
				note: '外側（インフラ・CI・権限）の設定は、アプリを戻しても戻りません'
			});
		}
	}
	return found;
}

/** 戻す手順を組む。前の版が分からなければ打ち消すしかない */
export function buildRollbackPlan(input: RollbackInput): RollbackPlan {
	return {
		kind: input.previous ? 'redeploy' : 'revert',
		current: input.current,
		previous: input.previous,
		undone: [...input.commits],
		irreversible: findIrreversible(input.changedFiles)
	};
}

/** 戻すのに要る手間の目安。**戻らないものがあるほど重い** */
export function rollbackWeight(plan: RollbackPlan): 'light' | 'careful' | 'heavy' {
	if (plan.irreversible.some((entry) => entry.kind === 'migration')) {
		return 'heavy';
	}
	if (plan.irreversible.length > 0 || plan.kind === 'revert') {
		return 'careful';
	}
	return 'light';
}

const WEIGHT_LABEL: Record<ReturnType<typeof rollbackWeight>, string> = {
	light: 'そのまま戻せます',
	careful: '戻す前に確かめることがあります',
	heavy: 'コードだけでは戻りません'
};

/** 画面に出す要約 */
export function describeRollback(plan: RollbackPlan): string {
	const head =
		plan.kind === 'redeploy'
			? `${plan.current} → ${plan.previous} に戻します（${WEIGHT_LABEL[rollbackWeight(plan)]}）`
			: `${plan.current} を打ち消して出し直します（${WEIGHT_LABEL[rollbackWeight(plan)]}）`;
	const lines = [head, `  戻すと消える変更: ${plan.undone.length} 件`];
	for (const entry of plan.irreversible) {
		lines.push(`  戻らない: ${entry.evidence} — ${entry.note}`);
	}
	return lines.join('\n');
}

/**
 * 実際に走らせるスクリプト。
 *
 * **そのままでは走らない。** 先頭で止めてあり、読んだ人が引数を足して初めて動く。
 * 障害中に何も考えず貼れてしまう方が危ない。
 */
export function renderRollbackScript(plan: RollbackPlan): string {
	const lines = [
		'#!/usr/bin/env bash',
		'# Nimbus が下書きしたロールバック手順です。',
		'# 中身を読んでから `bash rollback.sh --run` で実行してください。',
		'set -euo pipefail',
		'',
		'if [ "${1:-}" != "--run" ]; then',
		'  echo "確認だけの実行です。中身を読んでから --run を付けてください。"',
		'  exit 0',
		'fi',
		''
	];
	if (plan.irreversible.length > 0) {
		lines.push('# ---- これは戻りません（このスクリプトの外の作業）----');
		for (const entry of plan.irreversible) {
			lines.push(`#   ${entry.evidence}: ${entry.note}`);
		}
		lines.push('');
	}
	if (plan.kind === 'redeploy' && plan.previous) {
		lines.push(
			`git fetch --tags`,
			`git checkout ${plan.previous}`,
			'# ここでいつもの配布手順を走らせます（例: npm run deploy）',
			`echo "${plan.previous} を出しました。動いていることを確かめてから、原因を追ってください。"`
		);
	} else {
		lines.push(
			`git revert --no-edit ${plan.current}`,
			'# 打ち消したものを出します（例: npm run deploy）',
			`echo "${plan.current} を打ち消しました。原因を追う前に、まず落ち着いたことを確かめてください。"`
		);
	}
	return `${lines.join('\n')}\n`;
}

/* ------------------------------------------------------------------ *
 * 急ぐ道（T-144）
 * ------------------------------------------------------------------ */

export interface HotfixInput {
	/** いま本番に出ている版。**ここから枝を切る**（main からではない） */
	productionTag: string;
	/** 戻す先の既定ブランチ */
	defaultBranch: string;
	/** 何を直すか。枝の名前に使う */
	summary: string;
}

export interface HotfixStep {
	title: string;
	command?: string;
	/** 急ぐときでも省かない段 */
	required: boolean;
	note?: string;
}

/** 枝の名前。日本語や記号は落として、読める形に詰める */
export function hotfixBranchName(productionTag: string, summary: string): string {
	const slug = summary
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	const base = productionTag.replace(/[^\w.-]/g, '-');
	return slug.length > 0 ? `hotfix/${base}-${slug}` : `hotfix/${base}`;
}

/**
 * 急ぐときの手順。
 *
 * **`main` から切らない。** 本番に出ている版から切る — main には未リリースの変更が
 * 積まれているので、そこから切ると直したいもの以外まで出てしまう。
 *
 * `required` が `false` の段は、急ぐときは後回しにしてよい。
 * `true` の段は**急いでいても省かない** — 省くと、直したつもりで別の障害を足すことになる。
 */
export function buildHotfixPlan(input: HotfixInput): HotfixStep[] {
	const branch = hotfixBranchName(input.productionTag, input.summary);
	return [
		{
			title: '戻し口を先に用意する',
			required: true,
			note: '直すより先に「戻せる」ことを確かめます。戻せないなら、それは急ぐ理由ではなく止まる理由です'
		},
		{
			title: '本番に出ている版から枝を切る',
			command: `git fetch --tags && git switch -c ${branch} ${input.productionTag}`,
			required: true,
			note: `${input.defaultBranch} から切ると、まだ出していない変更まで一緒に出ます`
		},
		{ title: '直す（**この障害に関係する変更だけ**）', required: true, note: 'ついでの整理はしません' },
		{
			title: '直った証拠になるテストを 1 つ足す',
			required: true,
			note: '再発したときに気づける唯一の仕掛けです。急いでいてもここは省きません'
		},
		{ title: 'テストを通す', required: true },
		{ title: 'レビューを頼む', required: false, note: '急ぐときは出したあとの事後レビューでも構いません' },
		{ title: 'リリースノートを書く', required: false, note: '落ち着いてからで構いません' },
		{
			title: '出す',
			command: `git tag ${input.productionTag}-hotfix && git push origin ${branch} --tags`,
			required: true
		},
		{ title: '直ったことを本番で確かめる', required: true },
		{
			title: `${input.defaultBranch} へ戻す`,
			command: `git switch ${input.defaultBranch} && git merge --no-ff ${branch}`,
			required: true,
			note: '**ここを忘れると、次のリリースで同じ障害がもう一度出ます。** 急ぐ道でいちばん抜ける段です'
		}
	];
}

/** 急ぐときに残る段だけ */
export function urgentSteps(steps: readonly HotfixStep[]): HotfixStep[] {
	return steps.filter((step) => step.required);
}

/** 手順書。`urgent` のときは省く段を畳んで見せる（消しはしない） */
export function renderHotfixChecklist(steps: readonly HotfixStep[], urgent: boolean): string {
	const lines: string[] = [
		urgent ? '## ホットフィックス（急ぐ道）' : '## ホットフィックス',
		'',
		urgent
			? '急ぐので、後回しにしてよい段は末尾にまとめました。**省かない段は省きません。**'
			: '上から順に。',
		''
	];
	const main = urgent ? urgentSteps(steps) : steps;
	main.forEach((step, index) => {
		lines.push(`${index + 1}. ${step.title}`);
		if (step.command) {
			lines.push('', '   ```bash', `   ${step.command}`, '   ```');
		}
		if (step.note) {
			lines.push(`   — ${step.note}`);
		}
	});
	if (urgent) {
		const later = steps.filter((step) => !step.required);
		if (later.length > 0) {
			lines.push('', '### 落ち着いてから', '');
			for (const step of later) {
				lines.push(`- ${step.title}${step.note ? ` — ${step.note}` : ''}`);
			}
		}
	}
	return lines.join('\n');
}
