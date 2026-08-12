#!/usr/bin/env node
/**
 * `package.json` の表示文字列を `package.nls.json` へ出す（tasks.md T-091）。
 *
 * VS Code は `%キー%` を見つけると、起動時の言語に合わせて
 * `package.nls.<言語>.json` → `package.nls.json` の順で引く。
 * **翻訳が無ければ既定（日本語）にそのまま落ちる**ので、
 * 訳す人が現れるまで見た目は 1 文字も変わらない。
 *
 * `package.json` は 5 セッションが同時に触るので、**取り込みは何度でも回せる**ようにした。
 * 既に `%キー%` になっているものは触らず、新しく増えたものだけ拾う。
 *
 *   node nimbus/scripts/nls-extract.mjs          # 差分を見るだけ
 *   node nimbus/scripts/nls-extract.mjs --apply  # 書き換える
 *   node nimbus/scripts/nls-extract.mjs --check  # 取りこぼしがあれば終了コード 1（CI 用）
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '../../extensions/nimbus');
const PACKAGE = resolve(EXT, 'package.json');
const NLS = resolve(EXT, 'package.nls.json');
/** 訳の置き場所（拡張の外。理由は localeFiles を見よ） */
const I18N = resolve(HERE, '../i18n');

const APPLY = process.argv.includes('--apply');
const CHECK = process.argv.includes('--check');

/** 訳さないもの。製品名を訳すと、かえって分からなくなる */
const KEEP_AS_IS = new Set(['Nimbus']);

const isPlaceholder = (value) => typeof value === 'string' && /^%[\w.-]+%$/.test(value);
const needsExtraction = (value) =>
	typeof value === 'string' && value.length > 0 && !isPlaceholder(value) && !KEEP_AS_IS.has(value);

/** 設定キーからキー名を作る（`nimbus.` は共通なので落とす） */
const shortKey = (id) => id.replace(/^nimbus\./, '');

/**
 * 訳の置き場所。
 *
 * **拡張の中には置かない。** `package.nls.<言語>.json` を拡張の隣に置くと、
 * VS Code の既定ロケールが `en` なので**出荷物が既定で英語になる**。
 * Nimbus は日本語で使う道具なので、それは狙いと逆になる（実際に一度そうなった）。
 *
 * ここに置いたものは VS Code に読まれない。訳を配ると決めたときに、
 * 拡張の隣へ移すだけで効くようにしてある。
 */
function localeFiles() {
	if (!existsSync(I18N)) {
		return [];
	}
	return readdirSync(I18N)
		.map((name) => /^package\.nls\.([\w-]+)\.json$/.exec(name))
		.filter((match) => match !== null)
		.map((match) => ({ tag: match[1], path: resolve(I18N, match[0]) }));
}

export function collect(pkg) {
	/** @type {{key: string, value: string, set: (v: string) => void}[]} */
	const found = [];
	const add = (key, value, set) => {
		if (needsExtraction(value)) {
			found.push({ key, value, set });
		}
	};

	for (const [where, items] of Object.entries(pkg.contributes?.viewsContainers ?? {})) {
		for (const item of items) {
			add(`viewsContainer.${item.id}`, item.title, (v) => (item.title = v));
		}
		void where;
	}
	for (const items of Object.values(pkg.contributes?.views ?? {})) {
		for (const item of items) {
			add(`view.${item.id}`, item.name, (v) => (item.name = v));
		}
	}
	for (const item of pkg.contributes?.commands ?? []) {
		add(`command.${shortKey(item.command)}`, item.title, (v) => (item.title = v));
		// `category` は "Nimbus" なので KEEP_AS_IS で落ちる
		add(`command.${shortKey(item.command)}.category`, item.category, (v) => (item.category = v));
	}
	for (const items of Object.values(pkg.contributes?.menus ?? {})) {
		for (const item of items) {
			add(`menu.${shortKey(item.command ?? 'item')}`, item.title, (v) => (item.title = v));
		}
	}
	const configuration = pkg.contributes?.configuration;
	for (const block of Array.isArray(configuration) ? configuration : [configuration ?? {}]) {
		add('configuration.title', block.title, (v) => (block.title = v));
		for (const [id, property] of Object.entries(block.properties ?? {})) {
			add(`config.${shortKey(id)}`, property.description, (v) => (property.description = v));
			add(`config.${shortKey(id)}.md`, property.markdownDescription, (v) => (property.markdownDescription = v));
			(property.enumDescriptions ?? []).forEach((text, index) => {
				add(`config.${shortKey(id)}.enum.${index}`, text, (v) => (property.enumDescriptions[index] = v));
			});
		}
	}
	return found;
}

function main() {
	const raw = readFileSync(PACKAGE, 'utf8');
	const pkg = JSON.parse(raw);
	const found = collect(pkg);
	const nls = existsSync(NLS) ? JSON.parse(readFileSync(NLS, 'utf8')) : {};

	// 既に置き換わっているものが nls 側に無ければ、それは取りこぼし（`%キー%` がそのまま出る）
	const missing = [];
	const walk = (node) => {
		if (typeof node === 'string') {
			if (isPlaceholder(node) && !(node.slice(1, -1) in nls)) {
				missing.push(node);
			}
		} else if (node && typeof node === 'object') {
			Object.values(node).forEach(walk);
		}
	};
	walk(pkg.contributes ?? {});

	if (CHECK) {
		for (const key of missing) {
			process.stderr.write(`nls: ${key} が package.nls.json にありません\n`);
		}
		for (const item of found) {
			process.stderr.write(`nls: 未取り込み ${item.key} = ${item.value.slice(0, 40)}\n`);
		}
		// 訳が古びるのはここ。**日本語だけ足して訳を忘れる**のが一番起きる
		let stale = 0;
		for (const locale of localeFiles()) {
			const translated = JSON.parse(readFileSync(locale.path, 'utf8'));
			const untranslated = Object.keys(nls).filter((key) => !(key in translated));
			const orphan = Object.keys(translated).filter((key) => !(key in nls));
			for (const key of untranslated) {
				process.stderr.write(`nls: ${locale.tag} に訳がありません: ${key}\n`);
			}
			for (const key of orphan) {
				process.stderr.write(`nls: ${locale.tag} に余分なキーがあります: ${key}\n`);
			}
			stale += untranslated.length + orphan.length;
		}
		const bad = missing.length + found.length + stale;
		process.stdout.write(bad === 0 ? 'nls: 取りこぼしなし\n' : `nls: ${bad} 件\n`);
		return bad === 0 ? 0 : 1;
	}

	for (const item of found) {
		if (nls[item.key] !== undefined && nls[item.key] !== item.value) {
			process.stderr.write(`nls: キーが衝突しています: ${item.key}\n`);
			return 2;
		}
		nls[item.key] = item.value;
		item.set(`%${item.key}%`);
	}
	process.stdout.write(`nls: ${found.length} 件を取り込み、${Object.keys(nls).length} 件になります\n`);
	if (missing.length > 0) {
		process.stderr.write(`nls: 既存の取りこぼし ${missing.length} 件: ${missing.slice(0, 5).join(' ')}\n`);
	}
	if (!APPLY) {
		process.stdout.write('（--apply を付けると書き換えます）\n');
		return 0;
	}
	// 並びは元のまま。キーだけ並べ替えると差分が読めなくなる
	writeFileSync(PACKAGE, `${JSON.stringify(pkg, null, 2)}\n`);
	writeFileSync(NLS, `${JSON.stringify(nls, null, 2)}\n`);
	process.stdout.write('書き換えました。\n');
	return 0;
}

process.exit(main());
