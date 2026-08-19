/**
 * 承認（canUseTool）。
 *
 * Claude が書き込み・実行系のツールを使う前に、Nimbus が握って利用者に判断させる。
 * SDK は `canUseTool` の Promise が解決するまでそのツール実行を待つので、
 * ここで待たせている間セッションは止まる（＝勝手に進まない）。
 *
 * 旧 Electron 版は自前の「承認インボックス」画面を持っていたが、フォークでは
 * VS Code のモーダルに寄せる。判断を求める瞬間に前面へ出るぶん、見落としが起きにくい。
 * さらにファイルを書き換える系のツールは、**承認する前に差分を横に開く**。
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import { applyToProtectedPaths, enforceBlockProtectedReads } from './core/managedPolicy';
import { readManagedPolicy } from './managedPolicySource';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { buildPreview, ProposedEditPreviewer } from './proposedEdit';
import { describeTool } from './core/describe';
import { assessToolRisk, type RiskLevel } from './core/risk';
import { DEFAULT_PROTECTED_GLOBS, findBlockedRead, isNimbusReadOnlyTool } from './core/secrets';
import { formatRule, matchesAnyRule, suggestRule } from './core/approvalRules';
import { planPartialEdit, type PartialEditPlan } from './core/partialEdit';
import { isGeneratedPath, regenerationAdvice } from './core/generated';

/** 読み取りだけで副作用が無いツール。設定で自動許可できる */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite']);

/** 承認前に差分を出せるツール */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

/** 書き換え先のパス。取り出せなければ undefined（生成物の判定はパスが要る） */
function editTargetPath(input: unknown): string | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const record = input as Record<string, unknown>;
	for (const key of ['file_path', 'path', 'notebook_path']) {
		const value = record[key];
		if (typeof value === 'string' && value) {
			return value;
		}
	}
	return undefined;
}

export interface PendingApproval {
	/** 横断キュー（T-010）から名指しで答えるための ID */
	id: string;
	sessionId: string;
	toolName: string;
	summary: string;
	since: number;
	/** 承認待ちの一覧で「先に見るべきもの」を並べ替えるために持つ */
	risk: RiskLevel;
	/**
	 * 「今後この種類は常に許可」にしたときのルール（T-038）。
	 * 作れないとき（シェルの制御文字を含むコマンド）は undefined。
	 * 押せるのに効かない選択肢を出さないため、UI 側はこの有無でボタンを出し分ける。
	 */
	rule?: string;
}

/**
 * 承認の答え。`ignored` は「モーダルを Esc で閉じた＝答えなかった」で、拒否として扱うが
 * ログに残る文言が変わる（利用者の意思表示なのか、放置なのかは後から知りたい）。
 */
export type ApprovalDecision = 'allow' | 'allow-session' | 'always-allow' | 'deny' | 'ignored';

/** キューに積む 1 件。`settle` は最初の 1 回だけ効く（モーダルとビューの二重回答を無視する） */
interface QueueEntry extends PendingApproval {
	settle: (decision: ApprovalDecision) => void;
	/**
	 * 一部だけ採用（T-113）で組み直した入力。決まっていれば元の input の代わりにこれを渡す。
	 * 選択の途中で取りやめたときは付かない。
	 */
	partialInput?: Record<string, unknown>;
}

/**
 * 見出し。危険なものは**何が危ないのかを名指しする**（「危険です」だけでは判断できない）。
 * モーダルは本文が太字で出るので、ここには利用者が読むべき一文だけを置く。
 */
function riskHeading(level: RiskLevel, reasons: string[]): string {
	if (level === 'normal') {
		return 'Claude がツールを実行しようとしています。\n\n';
	}
	const mark = level === 'danger' ? '⚠️ 取り返しがつかない操作です' : '注意が要る操作です';
	return `${mark} — ${reasons.join(' / ')}\n\n`;
}

function riskDetail(level: RiskLevel): string | undefined {
	if (level === 'danger') {
		return '内容をそのまま実行します。元に戻せない可能性があるため「このセッションでは常に許可」は出していません。';
	}
	return undefined;
}

export interface PermissionDeps {
	/** セッションごとの「このセッションでは以後聞かない」記憶 */
	sessionAllowAll: Set<string>;
	log: (message: string) => void;
	previewer: ProposedEditPreviewer;
	/** 保留中の承認が増減したときに呼ばれる（ステータスバー表示などに使う） */
	onPendingChanged?: (pending: PendingApproval[]) => void;
	/**
	 * キューモード（T-010）。true のあいだはモーダルを出さず、承認キューに積んで待つ。
	 * 並列セッションではモーダルが 1 つずつしか出ず、「誰が何で止まっているか」が見えないため。
	 *
	 * **非同期なのは、面をこれから作る場合があるから**（T-286）。
	 * 「いま面が生きているか」を同期で見るだけだと、コックピットを開いていない利用者に
	 * 承認のたびモーダルが出る。開かせてから判断する。
	 */
	queueMode?: () => boolean | Promise<boolean>;
	/** 保存済みの「常に許可」ルール（T-038） */
	alwaysAllowRules?: () => readonly string[];
	/** 「今後この種類は常に許可」を押されたときにルールを保存する（T-038） */
	onAlwaysAllow?: (rule: string) => Promise<void> | void;
}

export function createPermissionBroker(deps: PermissionDeps): {
	canUseToolFor: (sessionId: string) => CanUseTool;
	pending: () => PendingApproval[];
	/** キューから名指しで答える（T-010）。まだ待っていれば true */
	decide: (id: string, decision: ApprovalDecision) => boolean;
	/** 待っているものを全部拒否する。緊急停止（T-057）から呼ぶ。返り値は件数 */
	denyAll: () => number;
} {
	const pending: QueueEntry[] = [];

	/** 外へ渡す形。`settle` は内部の都合なので境界を越えさせない */
	function toPublic(entry: QueueEntry): PendingApproval {
		return {
			id: entry.id,
			sessionId: entry.sessionId,
			toolName: entry.toolName,
			summary: entry.summary,
			since: entry.since,
			risk: entry.risk,
			rule: entry.rule
		};
	}

	function notify(): void {
		deps.onPendingChanged?.(pending.map(toPublic));
	}

	function decide(id: string, decision: ApprovalDecision): boolean {
		const entry = pending.find((e) => e.id === id);
		if (!entry) {
			return false;
		}
		entry.settle(decision);
		return true;
	}

	function denyAll(): number {
		// settle が pending を書き換えるので、複製に対して回す
		const waiting = [...pending];
		for (const entry of waiting) {
			entry.settle('deny');
		}
		return waiting.length;
	}

	function canUseToolFor(sessionId: string): CanUseTool {
		return async (toolName, input): Promise<PermissionResult> => {
			const config = vscode.workspace.getConfiguration('nimbus');
			const summary = describeTool(toolName, input);

			// 秘匿ファイルの読み取りは、承認を出す前に断る（T-164）。
			// 「許可」を押し間違える余地を残さない。一度読まれたら取り消せないため。
			const managed = readManagedPolicy();
			// 組織が「外させない」と決めていれば、設定で切られていても遮断する（T-212）
			const blockReads = enforceBlockProtectedReads(
				managed,
				config.get<boolean>('safety.blockProtectedReads') !== false
			).value;
			if (blockReads) {
				const configured = config.get<string[]>('safety.protectedPaths');
				// 組織が挙げたパスは必ず入る（利用者は足せるが外せない）
				const globs = applyToProtectedPaths(
					managed,
					configured?.length ? configured : DEFAULT_PROTECTED_GLOBS
				).value;
				const blocked = findBlockedRead(toolName, input, globs);
				if (blocked) {
					deps.log(`[permission] 遮断（秘匿ファイル）: ${blocked.path}`);
					void vscode.window.showWarningMessage(
						`Nimbus: 秘匿ファイルの読み取りを止めました（${blocked.path}）。読ませる必要があるときは設定 nimbus.safety.protectedPaths から外してください。`
					);
					return {
						behavior: 'deny',
						message: `Nimbus が秘匿ファイルの読み取りを拒否しました: ${blocked.path}（設定 nimbus.safety.protectedPaths）`
					};
				}
			}

			// Nimbus 自身が提供する読み取り専用ツール（LSP など）は常に通す。
			// 実装が Nimbus のコードなので副作用が無いと**分かっている**うえ、
			// 定義ジャンプのたびに承認を求めたら使いものにならない。
			// ただし上の秘匿ファイル遮断は先に通っている（何を返すかは別の話なので）
			if (isNimbusReadOnlyTool(toolName)) {
				return { behavior: 'allow', updatedInput: input };
			}

			// 危険度は自動許可より先に決める。「常に許可」で `rm -rf` まで素通りさせない（T-058）
			const risk = assessToolRisk(toolName, input);

			// 生成物への書き込みは、自動許可より先に止める（T-139）。
			// 次に生成ツールを回した瞬間に消えるので、**消えたと気づかないまま先に進む**のがいちばん損。
			// 自動許可の後ろに置くと黙って通ってしまうため、ここで聞く
			if (EDIT_TOOLS.has(toolName) && config.get<boolean>('safety.warnOnGeneratedEdit') !== false) {
				const target = editTargetPath(input);
				if (target && isGeneratedPath(target)) {
					const advice = regenerationAdvice(target);
					const EDIT = 'それでも直接書き換える';
					const choice = await vscode.window.showWarningMessage(
						`生成物を直接書き換えようとしています — ${target}`,
						{
							modal: true,
							detail: [
								'このファイルは生成ツールが作ります。直接書き換えても、次に生成し直したときに消えます。',
								advice ? `代わりに: ${advice}` : '元になっているファイルを直してください。'
							].join('\n\n')
						},
						EDIT
					);
					if (choice !== EDIT) {
						deps.log(`[permission] 拒否（生成物への書き込み）: ${target}`);
						return {
							behavior: 'deny',
							message: `${target} は生成物です。直接編集せず、${advice ?? '元になっているファイル'}を直してください。`
						};
					}
					deps.log(`[permission] 生成物への書き込みを利用者の判断で許可: ${target}`);
				}
			}

			if (
				risk.level !== 'danger' &&
				config.get<boolean>('permissions.autoApproveReadOnly') &&
				READ_ONLY_TOOLS.has(toolName)
			) {
				deps.log(`[permission] 自動許可（読み取り専用）: ${summary}`);
				return { behavior: 'allow', updatedInput: input };
			}
			if (risk.level !== 'danger' && deps.sessionAllowAll.has(sessionId)) {
				deps.log(`[permission] 自動許可（このセッションで許可済み）: ${summary}`);
				return { behavior: 'allow', updatedInput: input };
			}
			// 保存済みの「常に許可」ルール（T-038）。danger には効かせない — セッション内の
			// 「常に許可」と同じ扱いで、`rm -rf` をルールで素通りさせないため
			const rules = deps.alwaysAllowRules?.() ?? [];
			if (risk.level !== 'danger' && matchesAnyRule(rules, toolName, input)) {
				deps.log(`[permission] 自動許可（保存済みルール）: ${summary}`);
				return { behavior: 'allow', updatedInput: input };
			}

			// 書き換え系は、承認を求める前に「何が変わるのか」を差分で見せる
			let previewDisposable: vscode.Disposable | undefined;
			if (EDIT_TOOLS.has(toolName) && config.get<boolean>('permissions.showDiffBeforeApproval') !== false) {
				const preview = buildPreview(toolName, input, (path) => {
					try {
						return readFileSync(path, 'utf8');
					} catch {
						return undefined;
					}
				});
				if (preview) {
					try {
						previewDisposable = await deps.previewer.show(preview);
					} catch (error) {
						// 差分が出せなくても承認自体は続行させる（判断材料が減るだけ）
						deps.log(`[permission] 差分の表示に失敗: ${error instanceof Error ? error.message : String(error)}`);
					}
				}
			}

			// 危険なものは「常に許可」系を一切出さない。一度きりの判断として毎回聞く
			const rule = risk.level === 'danger' ? undefined : suggestRule(toolName, input);

			// 一部だけ採用（T-113）。採りたい変更と採りたくない変更が混ざっているときだけ出す。
			// 危険な書き込み先（システム領域など）では出さない — 一部でも書くこと自体が問題なので
			const partial =
				risk.level !== 'danger' && config.get<boolean>('permissions.offerPartialAccept') !== false
					? planPartialEdit(toolName, input, (path) => {
						try {
							return readFileSync(path, 'utf8');
						} catch {
							return undefined;
						}
					})
					: undefined;

			const entry: QueueEntry = {
				id: randomUUID(),
				sessionId,
				toolName,
				summary,
				since: Date.now(),
				risk: risk.level,
				rule: rule ? formatRule(rule) : undefined,
				settle: () => undefined
			};
			// executor は同期で走るので、この行を抜けた時点で settle は差し替わっている
			const decided = new Promise<ApprovalDecision>((resolve) => {
				let done = false;
				entry.settle = (decision) => {
					if (!done) {
						done = true;
						resolve(decision);
					}
				};
			});
			pending.push(entry);
			notify();

			try {
				// キューモード（＝会話のカードで受けられる）でなければ、その場でモーダルを出す。
				// await しないのは、キューからの回答（decide / denyAll）でも先に進めるようにするため。
				// 判断が非同期なのは、面をこれから作ることがあるため（T-286）
				void (async () => {
					if (await deps.queueMode?.()) {
						return;
					}
					entry.settle(await askInModal(entry, risk, partial));
				})();
				const decision = await decided;

				if (decision === 'allow-session') {
					deps.sessionAllowAll.add(sessionId);
				}
				if (decision === 'always-allow' && entry.rule) {
					await deps.onAlwaysAllow?.(entry.rule);
				}
				if (decision === 'allow' || decision === 'allow-session' || decision === 'always-allow') {
					// 一部だけ採用が決まっていれば、組み直した入力を渡す（T-113）
					if (entry.partialInput) {
						deps.log(`[permission] 一部だけ採用: ${summary}`);
						return { behavior: 'allow', updatedInput: entry.partialInput };
					}
					deps.log(`[permission] 許可（${risk.level}・${decision}）: ${summary}`);
					return { behavior: 'allow', updatedInput: input };
				}

				// モーダルを Esc で閉じた場合は ignored。
				// 「答えなかった」を許可に倒すのは危険なので、どちらも拒否として扱う。
				deps.log(`[permission] 拒否（${decision}）: ${summary}`);
				return {
					behavior: 'deny',
					message: decision === 'deny' ? '利用者が拒否しました' : '利用者が応答しませんでした'
				};
			} finally {
				const index = pending.indexOf(entry);
				if (index >= 0) {
					pending.splice(index, 1);
				}
				notify();
				previewDisposable?.dispose();
			}
		};
	}

	/**
	 * その場で聞くモーダル。キューモードでないときの既定の経路で、文言と選択肢は
	 * 安全機能を入れる前から変えていない（「今後この種類は常に許可」だけを足した）。
	 */
	async function askInModal(
		entry: QueueEntry,
		risk: { level: RiskLevel; reasons: string[] },
		partial?: PartialEditPlan
	): Promise<ApprovalDecision> {
		const ALLOW = '許可';
		const PARTIAL = partial ? `一部だけ採用（${partial.parts.length} か所から選ぶ）` : undefined;
		const ALLOW_SESSION = 'このセッションでは常に許可';
		const ALWAYS = entry.rule ? `今後「${entry.rule}」は常に許可` : undefined;
		const DENY = '拒否';
		const choices =
			risk.level === 'danger'
				? [ALLOW, DENY]
				: [ALLOW, ...(PARTIAL ? [PARTIAL] : []), ALLOW_SESSION, ...(ALWAYS ? [ALWAYS] : []), DENY];
		const choice = await vscode.window.showWarningMessage(
			riskHeading(risk.level, risk.reasons) + entry.summary,
			{ modal: true, detail: riskDetail(risk.level) },
			...choices
		);
		if (choice === ALLOW) {
			return 'allow';
		}
		if (PARTIAL && partial && choice === PARTIAL) {
			// 選び終わるまでは何も決まらない。取りやめたら拒否に倒す（黙って全部書かせない）
			const rebuilt = await pickParts(partial);
			if (!rebuilt) {
				return 'deny';
			}
			entry.partialInput = rebuilt;
			return 'allow';
		}
		if (choice === ALLOW_SESSION) {
			return 'allow-session';
		}
		if (ALWAYS && choice === ALWAYS) {
			return 'always-allow';
		}
		return choice === DENY ? 'deny' : 'ignored';
	}

	/**
	 * 採用する部分を選ばせる（T-113）。
	 * 既定では**全部にチェックが入った状態**で出す。ここまで来た人は「だいたい採りたい」ので、
	 * 外すほうを選ばせるほうが手数が少ない。1 つも選ばずに決定したら拒否として扱う。
	 */
	async function pickParts(plan: PartialEditPlan): Promise<Record<string, unknown> | undefined> {
		const items = plan.parts.map((part, index) => ({
			label: part.label,
			detail: part.detail,
			picked: true,
			index
		}));
		const chosen = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			title: '採用する変更を選ぶ（外したものは元のまま残ります）',
			placeHolder: 'チェックを外した変更は適用されません'
		});
		if (!chosen || chosen.length === 0) {
			return undefined;
		}
		return plan.rebuild(new Set(chosen.map((item) => item.index)));
	}

	return { canUseToolFor, pending: () => pending.map(toPublic), decide, denyAll };
}
