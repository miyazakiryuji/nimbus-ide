/**
 * 承認ポリシーのプロファイルと、サンドボックス（tasks.md T-162 / T-163）。
 *
 * 許可の広さは、**何をしているかで変わる**。ライブラリを調べているときと、
 * 本番の設定に触れる作業をしているときで、同じ広さのままなのは危ない。
 * かといって毎回 5 つの設定を手で切り替えるのは続かないので、**まとめて名前で切り替える**。
 *
 * SDK 実測で `Options.sandbox` があり、ネットワークとファイルシステムを絞れる。
 * 「危ないことを試すときの器」（T-163）はこれで作れる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/** SDK の `SandboxSettings` と構造互換（使うぶんだけ） */
export interface SandboxPolicy {
	enabled: boolean;
	/** 繋いでよいドメイン。空 + `denyAll` で全遮断 */
	allowedDomains?: string[];
	/** 許可した先以外を塞ぐ */
	denyAll?: boolean;
	/** 書き込みを禁じる場所 */
	denyWrite?: string[];
}

export interface PolicyProfile {
	name: string;
	description: string;
	/** SDK の permissionMode */
	permissionMode: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
	/** 読み取り専用ツールを確認なしで通すか */
	autoApproveReadOnly: boolean;
	/** 秘匿ファイルの読み取りを遮断するか（T-164） */
	blockProtectedReads: boolean;
	sandbox: SandboxPolicy;
}

/**
 * 出荷時のプロファイル。
 * **「本番接続時」を最初から用意する**のが肝 — 危ないと分かってから作るのでは遅い。
 */
export const BUILTIN_PROFILES: readonly PolicyProfile[] = [
	{
		name: '開発',
		description: 'ふだんの作業。読み取りは自動で通し、書き込みは確認する',
		permissionMode: 'default',
		autoApproveReadOnly: true,
		blockProtectedReads: true,
		sandbox: { enabled: false }
	},
	{
		name: '調べるだけ',
		description: '書き換えさせない。調査・レビュー向け',
		permissionMode: 'plan',
		autoApproveReadOnly: true,
		blockProtectedReads: true,
		sandbox: { enabled: false }
	},
	{
		name: '本番に触る',
		description: '許可を最も狭く。すべて確認し、秘匿ファイルは遮断',
		permissionMode: 'default',
		autoApproveReadOnly: false,
		blockProtectedReads: true,
		sandbox: { enabled: false }
	},
	{
		name: '隔離（ネットワーク遮断）',
		description: '外に出さない・書かせない。怪しいものを試すときの器',
		permissionMode: 'default',
		autoApproveReadOnly: true,
		blockProtectedReads: true,
		sandbox: { enabled: true, denyAll: true, allowedDomains: [] }
	}
];

/**
 * SDK に渡す形へ変換する。
 * **無効なときは何も渡さない** — `enabled: false` を明示的に渡すより、
 * 触らないほうが本体の既定に任せられる。
 */
export function toSdkSandbox(policy: SandboxPolicy): Record<string, unknown> | undefined {
	if (!policy.enabled) {
		return undefined;
	}
	const network: Record<string, unknown> = {};
	if (policy.allowedDomains && policy.allowedDomains.length > 0) {
		network['allowedDomains'] = policy.allowedDomains;
	}
	if (policy.denyAll) {
		// 許可した先以外を塞ぐ。許可が空なら全遮断になる
		network['strictAllowlist'] = true;
	}
	const sandbox: Record<string, unknown> = { enabled: true };
	if (Object.keys(network).length > 0) {
		sandbox['network'] = network;
	}
	if (policy.denyWrite && policy.denyWrite.length > 0) {
		sandbox['filesystem'] = { denyWrite: policy.denyWrite };
	}
	return sandbox;
}

/** いま効いている広さを 1 行で。**切り替えたことに気づけるように** */
export function describeProfile(profile: PolicyProfile): string {
	const parts: string[] = [profile.permissionMode];
	parts.push(profile.autoApproveReadOnly ? '読み取りは自動' : 'すべて確認');
	if (profile.sandbox.enabled) {
		parts.push(profile.sandbox.denyAll ? 'ネットワーク遮断' : 'サンドボックス');
	}
	if (!profile.blockProtectedReads) {
		// 遮断を切っているのは例外的な状態なので、必ず見せる
		parts.push('⚠️ 秘匿ファイルの遮断オフ');
	}
	return parts.join(' · ');
}

/** 名前で引く。見つからなければ「開発」に倒す（未知の名前で丸腰にしない） */
export function findProfile(profiles: readonly PolicyProfile[], name: string | undefined): PolicyProfile {
	return profiles.find((profile) => profile.name === name) ?? profiles[0] ?? BUILTIN_PROFILES[0];
}

/**
 * 切り替えが「広げる方向」かどうか。
 * 広げるときだけ確認を挟みたいので、呼び出し側が判断できるようにする。
 */
export function isWidening(from: PolicyProfile, to: PolicyProfile): boolean {
	if (to.permissionMode === 'bypassPermissions' && from.permissionMode !== 'bypassPermissions') {
		return true;
	}
	if (!to.blockProtectedReads && from.blockProtectedReads) {
		return true;
	}
	if (to.autoApproveReadOnly && !from.autoApproveReadOnly) {
		return true;
	}
	if (from.sandbox.enabled && !to.sandbox.enabled) {
		return true;
	}
	return false;
}
