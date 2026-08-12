/**
 * プラグインの一覧と、有効／無効（tasks.md T-032）。
 *
 * スキルの一覧は F6 で入れたが、**そのスキルがどこから来ているか**は
 * プラグイン単位でしか切り替えられない。「このプラグインを切りたい」と思ったとき、
 * いまは設定ファイルを開いて `enabledPlugins` を手で書き換えることになる。
 *
 * ここでは**読むだけ**をやる。入れる・切り替えるは `claude plugin` に任せる
 * （キャッシュの取得や検証を持っているのは CLI の側で、設定ファイルを横から
 * 書き換えると壊せてしまう）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface PluginRow {
	/** `name@marketplace` */
	id: string;
	name: string;
	marketplace: string;
	enabled: boolean;
	/** 入っているか（一覧にあるだけで未取得のものがある） */
	installed: boolean;
	version?: string;
	description?: string;
}

/** `installed_plugins.json`（version 2）から、入っているものを読む */
export function parseInstalled(json: string): { id: string; version?: string }[] {
	let data: { plugins?: Record<string, unknown> };
	try {
		data = JSON.parse(json) as { plugins?: Record<string, unknown> };
	} catch {
		return [];
	}
	const rows: { id: string; version?: string }[] = [];
	for (const [id, value] of Object.entries(data.plugins ?? {})) {
		// 同じプラグインが scope 違いで複数入ることがある。**新しい方を採る**
		const entries = (Array.isArray(value) ? value : [value]) as { version?: string; installedAt?: string }[];
		const newest = [...entries].sort((a, b) => (b.installedAt ?? '').localeCompare(a.installedAt ?? ''))[0];
		rows.push({ id, version: newest?.version });
	}
	return rows;
}

/**
 * `settings.json` の `enabledPlugins` を読む。
 *
 * **書かれていないものを「無効」と決めつけない。** 一覧に無いだけかもしれないので、
 * 呼び出し側が「入っているか」と合わせて判断する。
 */
export function parseEnabled(json: string): Map<string, boolean> {
	try {
		const settings = JSON.parse(json) as { enabledPlugins?: Record<string, boolean> };
		return new Map(Object.entries(settings.enabledPlugins ?? {}));
	} catch {
		return new Map();
	}
}

/** マーケットプレイスの目録（`.claude-plugin/marketplace.json`）を読む */
export function parseCatalog(json: string, marketplace: string): PluginRow[] {
	let data: { plugins?: unknown };
	try {
		data = JSON.parse(json) as { plugins?: unknown };
	} catch {
		return [];
	}
	const plugins = Array.isArray(data.plugins) ? data.plugins : [];
	const rows: PluginRow[] = [];
	for (const entry of plugins as { name?: string; description?: string; version?: string }[]) {
		if (typeof entry?.name !== 'string') {
			continue;
		}
		rows.push({
			id: `${entry.name}@${marketplace}`,
			name: entry.name,
			marketplace,
			enabled: false,
			installed: false,
			version: entry.version,
			description: entry.description
		});
	}
	return rows;
}

function splitId(id: string): { name: string; marketplace: string } {
	const at = id.lastIndexOf('@');
	return at === -1 ? { name: id, marketplace: '(不明)' } : { name: id.slice(0, at), marketplace: id.slice(at + 1) };
}

/**
 * 3 つを突き合わせる。
 *
 * **入っているのに目録に無いもの**（目録から消えた・手で入れた）を落とさない。
 * 落とすと「切りたいのに一覧に出てこない」になる。
 */
export function mergePlugins(
	installed: readonly { id: string; version?: string }[],
	enabled: ReadonlyMap<string, boolean>,
	catalog: readonly PluginRow[]
): PluginRow[] {
	const byId = new Map<string, PluginRow>();

	for (const row of catalog) {
		byId.set(row.id, { ...row });
	}
	for (const entry of installed) {
		const existing = byId.get(entry.id);
		if (existing) {
			existing.installed = true;
			existing.version = entry.version ?? existing.version;
			continue;
		}
		byId.set(entry.id, { id: entry.id, ...splitId(entry.id), enabled: false, installed: true, version: entry.version });
	}
	for (const [id, isEnabled] of enabled) {
		const existing = byId.get(id);
		if (existing) {
			existing.enabled = isEnabled;
			continue;
		}
		// 設定にはあるが入っていない（消したあとの残りかす）
		byId.set(id, { id, ...splitId(id), enabled: isEnabled, installed: false });
	}

	return [...byId.values()].sort(
		(a, b) =>
			Number(b.installed) - Number(a.installed) ||
			Number(b.enabled) - Number(a.enabled) ||
			a.name.localeCompare(b.name)
	);
}

export type PluginState = 'enabled' | 'disabled' | 'not-installed' | 'stale';

/**
 * いまどの状態か。
 *
 * **「設定にあるのに入っていない」を独立した状態として持つ。**
 * これを「無効」と一緒にすると、有効にしても何も起きない理由が分からなくなる。
 */
export function stateOf(row: PluginRow): PluginState {
	if (!row.installed) {
		return row.enabled ? 'stale' : 'not-installed';
	}
	return row.enabled ? 'enabled' : 'disabled';
}

const STATE_LABEL: Record<PluginState, string> = {
	enabled: '有効',
	disabled: '無効',
	'not-installed': '未取得',
	stale: '設定だけ残っている'
};

/** 一覧に出す 1 行 */
export function describeRow(row: PluginRow): { label: string; detail: string } {
	const state = stateOf(row);
	const mark = state === 'enabled' ? '$(check)' : state === 'stale' ? '$(warning)' : '$(circle-outline)';
	return {
		label: `${mark} ${row.name}`,
		detail: [
			STATE_LABEL[state],
			row.marketplace,
			row.version ? `v${row.version}` : undefined,
			row.description?.slice(0, 60)
		]
			.filter((part) => part !== undefined && part.length > 0)
			.join(' · ')
	};
}

/** 押したときに走らせる `claude plugin ...` の引数 */
export function commandFor(row: PluginRow): { args: string[]; description: string } {
	const state = stateOf(row);
	if (state === 'not-installed') {
		return { args: ['plugin', 'install', row.id], description: `${row.name} を入れます` };
	}
	if (state === 'stale') {
		return { args: ['plugin', 'install', row.id], description: `${row.name} は設定にありますが入っていません。入れ直します` };
	}
	return row.enabled
		? { args: ['plugin', 'disable', row.id], description: `${row.name} を無効にします` }
		: { args: ['plugin', 'enable', row.id], description: `${row.name} を有効にします` };
}

/** 変更が効くのはいつか。**その場で効くと思わせない** */
export const APPLIES_NEXT_SESSION = 'この変更は、次に始めるセッションから効きます（動いているセッションはそのままです）。';
