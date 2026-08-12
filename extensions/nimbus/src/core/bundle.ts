/**
 * 設定のパッケージ配布（tasks.md T-043）。
 *
 * スキル・サブエージェント・フック・コマンドを整えたあと、それを**チームに配る**手段が無い。
 * 「各自 `.claude/` にこれを置いてください」を口で伝えるのは続かない。
 *
 * まとめる先は `.claude/` の中身をそのまま写した ZIP …ではなく、
 * **1 枚の JSON**にする。中身が読めて、差分が取れて、レビューできる形のほうが、
 * 「何を配られたのか」が分かる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface BundleFile {
	/** `.claude/` からの相対パス */
	path: string;
	content: string;
}

export interface Bundle {
	/** 形式の版。読み込む側が古い版を弾けるように */
	version: 1;
	name: string;
	description?: string;
	createdAt: string;
	files: BundleFile[];
}

/** 配る対象。`settings.local.json` は個人の設定なので**入れない** */
export const BUNDLED_DIRECTORIES = ['skills', 'agents', 'commands'] as const;
export const BUNDLED_FILES = ['settings.json'] as const;

/** 配ってはいけないもの。名前で弾く（中身の検査は呼び出し側の sanitizer に任せる） */
const EXCLUDED = /(^|\/)(settings\.local\.json|\.env|.*\.pem|.*\.key|secrets?\.(json|ya?ml))$/i;

export function isBundlable(relativePath: string): boolean {
	if (EXCLUDED.test(relativePath)) {
		return false;
	}
	const top = relativePath.split('/')[0];
	return (BUNDLED_DIRECTORIES as readonly string[]).includes(top) || (BUNDLED_FILES as readonly string[]).includes(relativePath);
}

export function buildBundle(name: string, description: string, files: readonly BundleFile[], now: Date): Bundle {
	return {
		version: 1,
		name,
		description: description || undefined,
		createdAt: now.toISOString(),
		// 並びを固定する。差分が取れないと、配られたものの変化が読めない
		files: [...files].filter((file) => isBundlable(file.path)).sort((a, b) => a.path.localeCompare(b.path))
	};
}

export type BundleCheck = { ok: true; bundle: Bundle } | { ok: false; reason: string };

/**
 * 読み込む前に形を確かめる。
 * **知らない版は読まない**（新しい版を古い Nimbus が中途半端に展開するほうが危ない）。
 */
export function parseBundle(text: string): BundleCheck {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, reason: 'JSON として読めません' };
	}
	if (typeof parsed !== 'object' || parsed === null) {
		return { ok: false, reason: '中身が空です' };
	}
	const bundle = parsed as Partial<Bundle>;
	if (bundle.version !== 1) {
		return { ok: false, reason: `知らない形式です（version: ${String(bundle.version)}）` };
	}
	if (!bundle.name || !Array.isArray(bundle.files)) {
		return { ok: false, reason: '名前かファイル一覧がありません' };
	}
	for (const file of bundle.files) {
		if (typeof file?.path !== 'string' || typeof file?.content !== 'string') {
			return { ok: false, reason: 'ファイルの形が違います' };
		}
		// 配布物で `..` を許すと、`.claude/` の外へ書ける
		if (file.path.includes('..') || file.path.startsWith('/')) {
			return { ok: false, reason: `安全でないパスが入っています: ${file.path}` };
		}
		if (!isBundlable(file.path)) {
			return { ok: false, reason: `配れないものが入っています: ${file.path}` };
		}
	}
	return { ok: true, bundle: bundle as Bundle };
}

export interface ApplyPlan {
	/** 新しく置くもの */
	added: BundleFile[];
	/** 既にあって中身が違うもの（上書きの確認が要る） */
	conflicting: BundleFile[];
	/** 既にあって中身も同じもの（何もしない） */
	unchanged: BundleFile[];
}

/**
 * 展開する前に「何が起きるか」を出す。
 * **既存と違うものを黙って上書きしない** — 配られたもので自分の設定が消えるのが一番困る。
 */
export function planApply(bundle: Bundle, existing: ReadonlyMap<string, string>): ApplyPlan {
	const plan: ApplyPlan = { added: [], conflicting: [], unchanged: [] };
	for (const file of bundle.files) {
		const current = existing.get(file.path);
		if (current === undefined) {
			plan.added.push(file);
		} else if (current === file.content) {
			plan.unchanged.push(file);
		} else {
			plan.conflicting.push(file);
		}
	}
	return plan;
}

/** 展開の見通しを 1 行で */
export function describePlan(plan: ApplyPlan): string {
	return [
		plan.added.length > 0 ? `新規 ${plan.added.length}` : '',
		plan.conflicting.length > 0 ? `上書き ${plan.conflicting.length}` : '',
		plan.unchanged.length > 0 ? `変更なし ${plan.unchanged.length}` : ''
	]
		.filter(Boolean)
		.join(' · ') || '入っているものはありません';
}
