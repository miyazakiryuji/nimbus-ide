/**
 * 組織が決めた権限を、利用者が緩められないようにする（tasks.md T-212）。
 *
 * 会社で入れるとき、いちばん困るのは「**設定でいくらでも緩められる**」こと。
 * `nimbus.policy.profile` も `permissions.alwaysAllow` も利用者が書き換えられるので、
 * 「本番に触るときは全部確認する」と決めても、その場で外せてしまう。
 *
 * ここでは**管理者が置いた設定を上限として扱う**。利用者の設定は
 * 「それより狭くする」ぶんだけ効き、**広げる方向は効かない**。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { PolicyProfile } from './policyProfiles';

/**
 * 管理者が置くもの。**置かれていなければ何も変わらない**（既定は無管理）。
 *
 * 置き場所は VS Code の `ConfigurationTarget.Machine`（マシン単位の設定）を想定している。
 * MDM で配れる場所なので、利用者のワークスペース設定では上書きできない。
 */
export interface ManagedPolicy {
	/** 使ってよいプロファイル名。空なら制限しない */
	allowedProfiles?: string[];
	/** 秘匿ファイルの遮断を外させない */
	enforceBlockProtectedReads?: boolean;
	/** 自動許可のルールを一切認めない */
	forbidAlwaysAllow?: boolean;
	/** 許してよい自動許可ルール（`forbidAlwaysAllow` が偽のときだけ効く）。空なら制限しない */
	allowedAlwaysAllow?: string[];
	/** 監査ログを止めさせない */
	enforceAudit?: boolean;
	/** ここに書いたパスは必ず遮断する（利用者の設定に足す） */
	requiredProtectedPaths?: string[];
	/** なぜこの制限があるかを利用者に見せる文（問い合わせ先など） */
	contact?: string;
}

/** 何が効いていて、何が効かなかったか */
export interface PolicyDecision<T> {
	value: T;
	/** 管理者の設定で変わったか */
	overridden: boolean;
	/** 変わった理由。**黙って変えない**（黙って変えると壊れているように見える） */
	reason?: string;
}

const EMPTY: ManagedPolicy = {};

/** 管理設定が何も無いときは、判断そのものを行わない */
export function hasManagedPolicy(policy: ManagedPolicy | undefined): boolean {
	return policy !== undefined && Object.keys(policy).length > 0;
}

/**
 * プロファイルの選択を検査する。
 * 使ってよい一覧に無ければ、**一覧の先頭へ落とす**（拒否して何も動かないより、
 * 決められた範囲で動くほうがよい）。
 */
export function applyToProfile(
	policy: ManagedPolicy | undefined,
	profiles: readonly PolicyProfile[],
	requested: PolicyProfile
): PolicyDecision<PolicyProfile> {
	const managed = policy ?? EMPTY;
	const allowed = managed.allowedProfiles;
	let value = requested;
	let reason: string | undefined;

	if (allowed && allowed.length > 0 && !allowed.includes(requested.name)) {
		const fallback = profiles.find((profile) => profile.name === allowed[0]);
		if (fallback) {
			value = fallback;
			reason = `「${requested.name}」は組織の設定で使えません。「${fallback.name}」にしました`;
		} else {
			reason = `「${requested.name}」は組織の設定で使えません（代わりの ${allowed[0]} も見つかりません）`;
		}
	}

	// 遮断を外させない。プロファイル側が偽でも、管理設定が真なら真にする
	if (managed.enforceBlockProtectedReads && !value.blockProtectedReads) {
		value = { ...value, blockProtectedReads: true };
		reason = reason
			? `${reason} / 秘匿ファイルの遮断は外せません`
			: '秘匿ファイルの遮断は組織の設定で外せません';
	}

	return { value, overridden: reason !== undefined, reason };
}

/**
 * 自動許可のルールを絞る。
 * **広げる方向だけを止める。** 利用者が減らすぶんには触らない。
 */
export function applyToAlwaysAllow(
	policy: ManagedPolicy | undefined,
	requested: readonly string[]
): PolicyDecision<string[]> {
	const managed = policy ?? EMPTY;
	if (managed.forbidAlwaysAllow) {
		return requested.length === 0
			? { value: [], overridden: false }
			: {
				value: [],
				overridden: true,
				reason: `自動許可は組織の設定で使えません（${requested.length} 件を無視しました）`
			};
	}
	const allowed = managed.allowedAlwaysAllow;
	if (!allowed || allowed.length === 0) {
		return { value: [...requested], overridden: false };
	}
	const kept = requested.filter((rule) => allowed.includes(rule));
	const dropped = requested.filter((rule) => !allowed.includes(rule));
	return dropped.length === 0
		? { value: kept, overridden: false }
		: {
			value: kept,
			overridden: true,
			reason: `組織が認めていない自動許可を外しました: ${dropped.join(' / ')}`
		};
}

/**
 * 遮断するパスを合わせる。
 * 管理者が挙げたものは**必ず入る**。利用者は足せるが、外せない。
 */
export function applyToProtectedPaths(
	policy: ManagedPolicy | undefined,
	requested: readonly string[]
): PolicyDecision<string[]> {
	const required = policy?.requiredProtectedPaths ?? [];
	if (required.length === 0) {
		return { value: [...requested], overridden: false };
	}
	// 否定（`!` 付き）で打ち消されていたら、それも取り除く
	const negations = new Set(required.map((path) => `!${path}`));
	const cleaned = requested.filter((path) => !negations.has(path));
	const missing = required.filter((path) => !cleaned.includes(path));
	const value = [...cleaned, ...missing];
	const removed = requested.length - cleaned.length;
	return missing.length === 0 && removed === 0
		? { value, overridden: false }
		: {
			value,
			overridden: true,
			reason: `組織が指定した遮断パスを足しました${removed > 0 ? '（打ち消しも外しました）' : ''}: ${required.join(' / ')}`
		};
}

/**
 * 秘匿ファイルの遮断を、組織の設定で強制する。
 * プロファイルを通さない経路（`permissions.ts`）から使う。
 */
export function enforceBlockProtectedReads(
	policy: ManagedPolicy | undefined,
	requested: boolean
): PolicyDecision<boolean> {
	if (policy?.enforceBlockProtectedReads && !requested) {
		return { value: true, overridden: true, reason: '秘匿ファイルの遮断は組織の設定で外せません' };
	}
	return { value: requested, overridden: false };
}

/** 監査ログを止めさせない */
export function applyToAudit(policy: ManagedPolicy | undefined, requested: boolean): PolicyDecision<boolean> {
	if (policy?.enforceAudit && !requested) {
		return { value: true, overridden: true, reason: '監査ログは組織の設定で止められません' };
	}
	return { value: requested, overridden: false };
}

/**
 * いま何が組織に決められているかを、利用者に読める形で出す。
 *
 * **見えない制限を作らない。** 「なぜか設定が戻る」が一番たちが悪いので、
 * 設定画面に一覧で出せるようにする。
 */
export function describeManagedPolicy(policy: ManagedPolicy | undefined): string[] {
	if (!hasManagedPolicy(policy)) {
		return [];
	}
	const managed = policy ?? EMPTY;
	const lines: string[] = [];
	if (managed.allowedProfiles && managed.allowedProfiles.length > 0) {
		lines.push(`使えるポリシー: ${managed.allowedProfiles.join(' / ')}`);
	}
	if (managed.enforceBlockProtectedReads) {
		lines.push('秘匿ファイルの遮断は外せません');
	}
	if (managed.forbidAlwaysAllow) {
		lines.push('自動許可は使えません');
	} else if (managed.allowedAlwaysAllow && managed.allowedAlwaysAllow.length > 0) {
		lines.push(`認められている自動許可: ${managed.allowedAlwaysAllow.join(' / ')}`);
	}
	if (managed.enforceAudit) {
		lines.push('監査ログは止められません');
	}
	if (managed.requiredProtectedPaths && managed.requiredProtectedPaths.length > 0) {
		lines.push(`必ず遮断するパス: ${managed.requiredProtectedPaths.join(' / ')}`);
	}
	if (managed.contact) {
		lines.push(`問い合わせ先: ${managed.contact}`);
	}
	return lines;
}
