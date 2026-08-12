/**
 * 足そうとしている依存を、足す前に見る（tasks.md T-118）。
 *
 * 依存はいちど入ると抜けない。**入れる瞬間だけが安く止められる場所**なのに、
 * その瞬間はいちばん急いでいる（動かしたいから足している）。
 *
 * だから判断材料は**その場で・短く**出す。調べに行かせた時点で読まれない。
 *
 * **良し悪しは決めない。** 使うかどうかは、その人の状況（締切・代替の有無）による。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface PackageFacts {
	name: string;
	/** 最終更新（ISO 文字列）。分からなければ undefined */
	lastPublished?: string;
	/** 週あたりのダウンロード数 */
	weeklyDownloads?: number;
	license?: string;
	/** 依存の数（そのパッケージがさらに引っ張るもの） */
	dependencyCount?: number;
	/** すでに入っている、似た役割のもの */
	similarInstalled?: string[];
	/** 非推奨の告知 */
	deprecated?: string;
}

export type Flag = 'stale' | 'few-users' | 'heavy' | 'deprecated' | 'duplicate' | 'unknown-license';

export interface AuditResult {
	name: string;
	flags: Flag[];
	notes: string[];
}

/** これ以上更新が止まっていたら、触れておく（放置＝悪ではないが、知っておく価値はある） */
const STALE_DAYS = 365;

/** これ未満なら、使っている人が少ない */
const FEW_USERS = 1000;

/** これ以上引っ張るなら、重い */
const HEAVY_DEPS = 20;

export function daysSince(iso: string, now: number): number {
	const at = Date.parse(iso);
	return Number.isNaN(at) ? Number.POSITIVE_INFINITY : Math.floor((now - at) / 86_400_000);
}

/**
 * 気になる点を挙げる。
 *
 * **数字をそのまま出す。**「危険」「安全」とは言わない — 判断はその人の状況による。
 */
export function audit(facts: PackageFacts, now: number): AuditResult {
	const flags: Flag[] = [];
	const notes: string[] = [];

	if (facts.deprecated) {
		flags.push('deprecated');
		notes.push(`作者が非推奨と言っています: ${facts.deprecated}`);
	}

	if (facts.lastPublished) {
		const days = daysSince(facts.lastPublished, now);
		if (days >= STALE_DAYS) {
			flags.push('stale');
			notes.push(`最終更新から ${Math.floor(days / 30)} か月`);
		}
	} else {
		notes.push('最終更新が分かりません');
	}

	if (facts.weeklyDownloads !== undefined && facts.weeklyDownloads < FEW_USERS) {
		flags.push('few-users');
		notes.push(`週 ${facts.weeklyDownloads} ダウンロード（使っている人は少なめ）`);
	}

	if (facts.dependencyCount !== undefined && facts.dependencyCount >= HEAVY_DEPS) {
		flags.push('heavy');
		notes.push(`さらに ${facts.dependencyCount} 個を引っ張ります`);
	}

	if (facts.similarInstalled && facts.similarInstalled.length > 0) {
		flags.push('duplicate');
		notes.push(`似た役割のものが既にあります: ${facts.similarInstalled.join(' / ')}`);
	}

	if (!facts.license || facts.license.trim().length === 0) {
		flags.push('unknown-license');
		notes.push('ライセンスの記載がありません');
	}

	return { name: facts.name, flags, notes };
}

/** 名前が似ているものを、既に入っているものから探す（役割が重なりやすい） */
export function findSimilar(name: string, installed: readonly string[]): string[] {
	const core = name.toLowerCase().replace(/^@[^/]+\//, '').replace(/[-_.]/g, '');
	return installed.filter((other) => {
		if (other === name) {
			return false;
		}
		const otherCore = other.toLowerCase().replace(/^@[^/]+\//, '').replace(/[-_.]/g, '');
		return otherCore.includes(core) || core.includes(otherCore);
	});
}

export function renderAudit(result: AuditResult): string {
	if (result.flags.length === 0 && result.notes.length === 0) {
		return `# ${result.name}\n\n気になる点はありませんでした。\n`;
	}

	const lines = [`# ${result.name} を足す前に`, ''];
	for (const note of result.notes) {
		lines.push(`- ${note}`);
	}
	lines.push('');
	lines.push(
		'**良し悪しは決めていません。** 締切や代替の有無によって、これで問題ないこともあります。',
		'知らずに入れるのと、知って入れるのは別なので、事実だけ置いています。',
		''
	);
	return lines.join('\n');
}
