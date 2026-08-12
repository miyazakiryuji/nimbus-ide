/**
 * LSP をエージェントのツールにするための、VS Code に依存しない部分（tasks.md T-098）。
 *
 * grep の総当たりでは「同じ名前の別物」を拾ってしまうし、定義を探すだけで何度も
 * ファイルを読むことになる。フォークの中では言語サーバーがすでに動いているので、
 * その答え（定義・参照・型・呼び出し階層）をそのまま Claude に渡せる。
 *
 * ここに置くのは「入力の解決」と「結果の整形」だけ。VS Code の API を叩く部分は
 * `src/lspTools.ts` に閉じ込め、こちらは拡張ホストなしで検証できるようにしておく。
 */
import { existsSync } from 'fs';
import { isAbsolute, relative, resolve } from 'path';

/** 位置と範囲。行・桁はすべて 0 起点（VS Code の Position と同じ） */
export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

/** ドキュメントのアウトライン 1 件（VS Code の DocumentSymbol を型に依存せず写したもの） */
export interface OutlineSymbol {
	name: string;
	kind: number;
	range: LspRange;
	/** 名前そのものの範囲。ジャンプ位置にはこちらを使う */
	selection?: LspRange;
	children?: OutlineSymbol[];
}

/** 整形して返す 1 件。file は絶対パス */
export interface LocationEntry {
	file: string;
	range: LspRange;
	/** その行のソース（あれば添える。1 行あれば「どんな使われ方か」がだいたい分かる） */
	preview?: string;
}

/**
 * SymbolKind（VS Code の数値 enum）を読める言葉にする。
 * vscode を import せずに済むよう、数値の対応表をこちらに持つ。
 */
const SYMBOL_KIND_LABELS = [
	'File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field',
	'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String',
	'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember', 'Struct',
	'Event', 'Operator', 'TypeParameter'
];

export function symbolKindLabel(kind: number): string {
	return SYMBOL_KIND_LABELS[kind] ?? 'Symbol';
}

/** DiagnosticSeverity（0=Error … 3=Hint）を読める言葉にする */
const SEVERITY_LABELS = ['error', 'warning', 'info', 'hint'];

export function severityLabel(severity: number): string {
	return SEVERITY_LABELS[severity] ?? 'info';
}

/**
 * ツールに渡されたパスをワークスペース内の絶対パスに解決する。
 *
 * モデルは相対パスで書いてくることが多いので受け付けるが、**ワークスペースの外は断る**。
 * 読み取りだけとはいえ、任意の場所のシンボル情報を引けてしまうのは筋が悪い。
 */
export function resolveWorkspacePath(
	roots: readonly string[],
	input: string,
	exists: (path: string) => boolean = existsSync
): { path: string } | { error: string } {
	const raw = input.trim();
	if (raw.length === 0) {
		return { error: 'file を指定してください。' };
	}
	if (roots.length === 0) {
		return { error: 'フォルダが開かれていません。' };
	}

	const candidates = isAbsolute(raw) ? [resolve(raw)] : roots.map((root) => resolve(root, raw));
	const inside = candidates.filter((candidate) => roots.some((root) => isInside(root, candidate)));
	if (inside.length === 0) {
		return { error: `ワークスペースの外は参照できません: ${raw}` };
	}
	const found = inside.find(exists);
	if (!found) {
		return { error: `ファイルが見つかりません: ${raw}` };
	}
	return { path: found };
}

function isInside(root: string, candidate: string): boolean {
	const rel = relative(resolve(root), candidate);
	return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** 表示用の相対パス。どのルートにも属さないときは絶対パスのまま返す */
export function displayPath(roots: readonly string[], file: string): string {
	for (const root of roots) {
		const rel = relative(resolve(root), resolve(file));
		if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
			return rel;
		}
	}
	return file;
}

/**
 * 1 起点の行・桁（利用者とモデルが読む数え方）を 0 起点に落とす。
 * Read ツールの出力が 1 起点なので、そこに合わせないと必ずズレる。
 */
export function toPosition(line: number, column?: number): { position: LspPosition } | { error: string } {
	if (!Number.isFinite(line) || line < 1) {
		return { error: 'line は 1 以上の整数で指定してください（1 行目が 1）。' };
	}
	if (column !== undefined && (!Number.isFinite(column) || column < 1)) {
		return { error: 'column は 1 以上の整数で指定してください（行頭が 1）。' };
	}
	return { position: { line: Math.floor(line) - 1, character: column === undefined ? 0 : Math.floor(column) - 1 } };
}

/**
 * アウトラインから名前でシンボルを探す。
 *
 * モデルは行番号ではなく名前で聞いてくる（「この関数の参照を出して」）。
 * `Class.method` のような入れ子の指定も受け付ける。完全一致 → 大文字小文字を無視 →
 * 末尾一致（`method` で `Class.method` に当てる）の順に落としていく。
 */
export function findSymbol(symbols: readonly OutlineSymbol[], name: string): OutlineSymbol | undefined {
	const wanted = name.trim();
	if (wanted.length === 0) {
		return undefined;
	}
	const flat = flattenSymbols(symbols, []);
	const lower = wanted.toLowerCase();

	return (
		flat.find((entry) => entry.path === wanted)?.symbol ??
		flat.find((entry) => entry.symbol.name === wanted)?.symbol ??
		flat.find((entry) => entry.path.toLowerCase() === lower)?.symbol ??
		flat.find((entry) => entry.symbol.name.toLowerCase() === lower)?.symbol ??
		flat.find((entry) => entry.path.toLowerCase().endsWith(`.${lower}`))?.symbol
	);
}

interface FlatSymbol {
	/** `Class.method` の形にした経路 */
	path: string;
	symbol: OutlineSymbol;
}

/** 浅い方を先に返す（同名なら外側の宣言を優先したい） */
export function flattenSymbols(symbols: readonly OutlineSymbol[], prefix: readonly string[]): FlatSymbol[] {
	const here: FlatSymbol[] = [];
	const deeper: FlatSymbol[] = [];
	for (const symbol of symbols) {
		const path = [...prefix, symbol.name].join('.');
		here.push({ path, symbol });
		if (symbol.children?.length) {
			deeper.push(...flattenSymbols(symbol.children, [...prefix, symbol.name]));
		}
	}
	return [...here, ...deeper];
}

/** ジャンプに使う位置。名前の範囲があればそこ、無ければ範囲の先頭 */
export function symbolPosition(symbol: OutlineSymbol): LspPosition {
	return (symbol.selection ?? symbol.range).start;
}

/** 宣言らしい行を優先するための手がかり（言語をまたいで効く最小限のもの） */
const DECLARATION_HINTS = [
	'function', 'class', 'interface', 'type', 'enum', 'struct', 'const', 'let', 'var',
	'def', 'fn', 'func', 'impl', 'trait', 'module', 'namespace', 'export', 'public',
	'private', 'protected', 'static', 'async', 'final', 'abstract', 'void'
];

/**
 * アウトラインが取れない言語（プレーンテキスト・未対応の拡張子）向けの保険。
 * 本文から名前を探し、**宣言らしい行を優先する**。
 * 呼び出し箇所の 1 つ目を掴んで「定義が見つからない」と言われるのを避けるため。
 *
 * `Class.method` の形で来たときは末尾（`method`）だけを探す。
 * 本文の文字列としては入れ子の関係が現れないため。
 */
export function positionInText(text: string, name: string): LspPosition | undefined {
	const wanted = name.trim().split('.').pop() ?? '';
	if (wanted.length === 0) {
		return undefined;
	}
	const pattern = new RegExp(`\\b${escapeRegExp(wanted)}\\b`);
	const lines = text.split(/\r?\n/);
	let fallback: LspPosition | undefined;

	for (let line = 0; line < lines.length; line++) {
		const match = pattern.exec(lines[line]);
		if (!match) {
			continue;
		}
		const position = { line, character: match.index };
		if (looksLikeDeclaration(lines[line], match.index)) {
			return position;
		}
		fallback ??= position;
	}
	return fallback;
}

/**
 * 手がかりの語は**名前の直前**になければならない。
 * 行のどこかにあれば良いことにすると、`const other = run` の `run`（ただの参照）を
 * 宣言と見なしてしまう。修飾子とジェネレータの `*` だけは間に挟まることを許す。
 */
function looksLikeDeclaration(line: string, index: number): boolean {
	const before = line.slice(0, index).toLowerCase();
	return DECLARATION_HINTS.some((hint) => new RegExp(`(^|[^\\w])${hint}[\\s*]+$`).test(before));
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `src/a.ts:12:3` の形。行・桁は 1 起点に戻して出す（Read の出力と数え方を揃える） */
export function formatLocation(roots: readonly string[], entry: LocationEntry): string {
	const head = `${displayPath(roots, entry.file)}:${entry.range.start.line + 1}:${entry.range.start.character + 1}`;
	const preview = entry.preview?.trim();
	return preview ? `${head}  ${preview}` : head;
}

/** 件数が多いときは切って「他 N 件」を添える。文脈を溶かさないための上限 */
export function renderLocations(
	roots: readonly string[],
	entries: readonly LocationEntry[],
	limit: number
): string {
	if (entries.length === 0) {
		return '（見つかりませんでした）';
	}
	const shown = entries.slice(0, limit).map((entry) => formatLocation(roots, entry));
	const omitted = entries.length - shown.length;
	return omitted > 0 ? [...shown, `…他 ${omitted} 件`].join('\n') : shown.join('\n');
}

/** アウトラインを字下げしたテキストにする。木の形のまま渡した方がモデルは読み違えない */
export function renderOutline(symbols: readonly OutlineSymbol[], depth = 0): string {
	const lines: string[] = [];
	for (const symbol of symbols) {
		const indent = '  '.repeat(depth);
		const start = symbol.range.start.line + 1;
		const end = symbol.range.end.line + 1;
		lines.push(`${indent}- ${symbolKindLabel(symbol.kind)} ${symbol.name}  (${start}–${end})`);
		if (symbol.children?.length) {
			lines.push(renderOutline(symbol.children, depth + 1));
		}
	}
	return lines.join('\n');
}

/** 行の範囲（0 起点・両端を含む）を切り出す。シンボル単位で渡すため（T-099） */
export function sliceLines(text: string, startLine: number, endLine: number): string {
	const lines = text.split(/\r?\n/);
	const from = Math.max(0, startLine);
	const to = Math.min(lines.length - 1, Math.max(from, endLine));
	return lines.slice(from, to + 1).join('\n');
}

/** import 行の「読み込み先」を指す位置。ここで定義ジャンプすると実ファイルに当たる */
const IMPORT_LINE = /^\s*(?:import|export|from|#include|part|library|use|require)\b|\brequire\s*\(/;
const QUOTED = /['"<]([^'">\n]+)['">]/;
const BARE_MODULE = /^\s*(?:from|import|use)\s+([A-Za-z_@][\w.:/-]*)/;

/**
 * import 文の「相手」の位置を集める（T-100）。
 *
 * 言語ごとに構文は違うが、**引用符の中か、`from` / `import` の直後の語**を指せば、
 * どの言語でも定義ジャンプが解決してくれる。構文解析は持ち込まない
 * （言語の数だけパーサを抱えることになるし、外れても「依存が 1 件減る」だけで済む）。
 */
export function importSpecifierPositions(text: string, limit = 100): LspPosition[] {
	const found: LspPosition[] = [];
	const lines = text.split(/\r?\n/);
	for (let line = 0; line < lines.length && found.length < limit; line++) {
		const source = lines[line];
		if (!IMPORT_LINE.test(source)) {
			continue;
		}
		const quoted = QUOTED.exec(source);
		if (quoted) {
			found.push({ line, character: quoted.index + 1 });
			continue;
		}
		const bare = BARE_MODULE.exec(source);
		if (bare) {
			found.push({ line, character: source.indexOf(bare[1]) });
		}
	}
	return found;
}

/** ファイルの一覧。件数が多いときは切って「他 N 件」を添える */
export function renderFileList(roots: readonly string[], files: readonly string[], limit: number): string {
	if (files.length === 0) {
		return '（ありません）';
	}
	const shown = files.slice(0, limit).map((file) => displayPath(roots, file));
	const omitted = files.length - shown.length;
	return omitted > 0 ? [...shown, `…他 ${omitted} 件`].join('\n') : shown.join('\n');
}

/**
 * hover の中身をテキストに均す。
 * 同じ内容が複数のプロバイダから返ることがあるので重複を落とし、長すぎるものは切る。
 */
export function renderHover(contents: readonly string[], limit = 2000): string {
	const seen = new Set<string>();
	const parts: string[] = [];
	for (const content of contents) {
		const trimmed = content.trim();
		if (trimmed.length === 0 || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		parts.push(trimmed);
	}
	if (parts.length === 0) {
		return '（型情報は取得できませんでした）';
	}
	const joined = parts.join('\n\n');
	return joined.length > limit ? `${joined.slice(0, limit)}\n…（省略）` : joined;
}
