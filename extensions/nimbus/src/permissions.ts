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
import { readFileSync } from 'fs';
import * as vscode from 'vscode';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import { buildPreview, ProposedEditPreviewer } from './proposedEdit';
import { describeTool } from './core/describe';
import { assessToolRisk, type RiskLevel } from './core/risk';
import { DEFAULT_PROTECTED_GLOBS, findBlockedRead, isNimbusReadOnlyTool } from './core/secrets';

/** 読み取りだけで副作用が無いツール。設定で自動許可できる */
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead', 'TodoWrite']);

/** 承認前に差分を出せるツール */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export interface PendingApproval {
	sessionId: string;
	toolName: string;
	summary: string;
	since: number;
	/** 承認待ちの一覧で「先に見るべきもの」を並べ替えるために持つ */
	risk: RiskLevel;
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
}

export function createPermissionBroker(deps: PermissionDeps): {
	canUseToolFor: (sessionId: string) => CanUseTool;
	pending: () => PendingApproval[];
} {
	const pending: PendingApproval[] = [];

	function notify(): void {
		deps.onPendingChanged?.([...pending]);
	}

	function canUseToolFor(sessionId: string): CanUseTool {
		return async (toolName, input): Promise<PermissionResult> => {
			const config = vscode.workspace.getConfiguration('nimbus');
			const summary = describeTool(toolName, input);

			// 秘匿ファイルの読み取りは、承認を出す前に断る（T-164）。
			// 「許可」を押し間違える余地を残さない。一度読まれたら取り消せないため。
			if (config.get<boolean>('safety.blockProtectedReads') !== false) {
				const globs = config.get<string[]>('safety.protectedPaths');
				const blocked = findBlockedRead(toolName, input, globs?.length ? globs : DEFAULT_PROTECTED_GLOBS);
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

			const entry: PendingApproval = { sessionId, toolName, summary, since: Date.now(), risk: risk.level };
			pending.push(entry);
			notify();

			try {
				const ALLOW = '許可';
				const ALLOW_SESSION = 'このセッションでは常に許可';
				const DENY = '拒否';
				// 危険なものは「常に許可」を出さない。一度きりの判断として毎回聞く
				const choices = risk.level === 'danger' ? [ALLOW, DENY] : [ALLOW, ALLOW_SESSION, DENY];
				const choice = await vscode.window.showWarningMessage(
					riskHeading(risk.level, risk.reasons) + summary,
					{ modal: true, detail: riskDetail(risk.level) },
					...choices
				);

				if (choice === ALLOW_SESSION) {
					deps.sessionAllowAll.add(sessionId);
				}
				if (choice === ALLOW || choice === ALLOW_SESSION) {
					deps.log(`[permission] 許可（${risk.level}）: ${summary}`);
					return { behavior: 'allow', updatedInput: input };
				}

				// モーダルを Esc で閉じた場合も choice は undefined になる。
				// 「答えなかった」を許可に倒すのは危険なので拒否として扱う。
				deps.log(`[permission] 拒否: ${summary}`);
				return {
					behavior: 'deny',
					message: choice === DENY ? '利用者が拒否しました' : '利用者が応答しませんでした'
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

	return { canUseToolFor, pending: () => [...pending] };
}
