/**
 * LSP をエージェントのツールにする（tasks.md T-098）。
 *
 * Claude Code 単体では、定義を探すのも参照を数えるのも grep の総当たりになる。
 * 同じ名前の別物を拾うし、当たりを付けるだけで何度もファイルを読むので文脈も溶ける。
 * Nimbus は IDE のフォークなので、**言語サーバーはもうこのプロセスの隣で動いている**。
 * その答えをそのまま渡すのが、フォークにした一番の旨味。
 *
 * SDK の in-process MCP サーバー（`createSdkMcpServer`）として渡す。別プロセスを立てないので、
 * 拡張ホストが持っている `vscode.commands` をそのまま呼べる。
 *
 * 承認は `permissions.ts` の `mcp__nimbus_` 素通し規則に乗る（すべて読み取りのみ・副作用なし）。
 * 秘匿ファイルの遮断（`findBlockedRead`）は `file_path` を見るので、引数名はそれに揃えてある。
 */
import * as vscode from 'vscode';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import {
	displayPath,
	findSymbol,
	positionInText,
	renderHover,
	renderLocations,
	renderOutline,
	resolveWorkspacePath,
	severityLabel,
	symbolKindLabel,
	symbolPosition,
	toPosition,
	type LocationEntry,
	type LspRange,
	type OutlineSymbol
} from './core/lsp';

/** MCP サーバー名。ツール名は `mcp__nimbus_lsp__<tool>` になる */
export const LSP_SERVER_NAME = 'nimbus_lsp';

/** 一度に返す件数の上限。参照が 500 件ある関数を丸ごと渡しても読めない */
const RESULT_LIMIT = 40;

/** 言語サーバーが返ってこないときに諦める時間 */
const PROVIDER_TIMEOUT_MS = 15_000;

/** 起動直後は空で返ることがあるので、一度だけ待って引き直す */
const WARMUP_RETRY_MS = 700;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function textResult(text: string): ToolResult {
	return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): ToolResult {
	return { content: [{ type: 'text', text }], isError: true };
}

function workspaceRoots(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 返ってこないプロバイダでセッションを止めない */
async function withDeadline<T>(work: Thenable<T>, label: string): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work as Promise<T>,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error(`${label} が ${PROVIDER_TIMEOUT_MS / 1000} 秒以内に応答しませんでした`)),
					PROVIDER_TIMEOUT_MS
				);
			})
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

async function runCommand<T>(command: string, ...args: unknown[]): Promise<T | undefined> {
	return withDeadline(vscode.commands.executeCommand<T>(command, ...args), command);
}

/**
 * 一覧を返すプロバイダを叩く。空だったときだけ一度やり直す。
 * 言語サーバーは初回の問い合わせで温まるので、「1 回目が空」を答えとして返してしまうと
 * エージェントが「定義が無い」と誤解して grep に逃げる。
 */
async function runListCommand<T>(command: string, ...args: unknown[]): Promise<T[]> {
	const first = await runCommand<T[]>(command, ...args);
	if (first && first.length > 0) {
		return first;
	}
	await delay(WARMUP_RETRY_MS);
	return (await runCommand<T[]>(command, ...args)) ?? [];
}

function toRange(range: vscode.Range): LspRange {
	return {
		start: { line: range.start.line, character: range.start.character },
		end: { line: range.end.line, character: range.end.character }
	};
}

function toOutline(symbol: vscode.DocumentSymbol | vscode.SymbolInformation): OutlineSymbol {
	if ('selectionRange' in symbol) {
		return {
			name: symbol.name,
			kind: symbol.kind,
			range: toRange(symbol.range),
			selection: toRange(symbol.selectionRange),
			children: symbol.children?.map(toOutline)
		};
	}
	return { name: symbol.name, kind: symbol.kind, range: toRange(symbol.location.range) };
}

async function outlineOf(uri: vscode.Uri): Promise<OutlineSymbol[]> {
	const raw = await runListCommand<vscode.DocumentSymbol | vscode.SymbolInformation>(
		'vscode.executeDocumentSymbolProvider',
		uri
	);
	return raw.map(toOutline);
}

/** Location と LocationLink のどちらで返ってきても同じ形にする */
function toLocations(items: readonly (vscode.Location | vscode.LocationLink)[]): { uri: vscode.Uri; range: vscode.Range }[] {
	return items.map((item) =>
		'targetUri' in item
			? { uri: item.targetUri, range: item.targetSelectionRange ?? item.targetRange }
			: { uri: item.uri, range: item.range }
	);
}

/** 表示する分だけ、その行のソースを添える（開いていないファイルも読める） */
async function toEntries(
	locations: readonly { uri: vscode.Uri; range: vscode.Range }[],
	limit: number
): Promise<LocationEntry[]> {
	const entries: LocationEntry[] = [];
	const opened = new Map<string, vscode.TextDocument | undefined>();
	for (const [index, location] of locations.entries()) {
		const entry: LocationEntry = { file: location.uri.fsPath, range: toRange(location.range) };
		if (index < limit) {
			const key = location.uri.toString();
			if (!opened.has(key)) {
				opened.set(key, await openDocument(location.uri));
			}
			const document = opened.get(key);
			if (document && location.range.start.line < document.lineCount) {
				entry.preview = document.lineAt(location.range.start.line).text.trim();
			}
		}
		entries.push(entry);
	}
	return entries;
}

async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
	try {
		// 画面には出さない。開くのは言語拡張を起こして本文を読むため
		return await vscode.workspace.openTextDocument(uri);
	} catch {
		return undefined;
	}
}

interface Target {
	document: vscode.TextDocument;
	position: vscode.Position;
}

interface TargetArgs {
	file_path: string;
	symbol?: string;
	line?: number;
	column?: number;
}

/**
 * 「どのファイルのどの位置か」を決める。
 * モデルは行番号ではなく名前で聞いてくるので、`symbol` を第一の入口にする。
 */
async function resolveTarget(args: TargetArgs): Promise<Target | { error: string }> {
	const resolved = resolveWorkspacePath(workspaceRoots(), args.file_path);
	if ('error' in resolved) {
		return resolved;
	}
	const document = await openDocument(vscode.Uri.file(resolved.path));
	if (!document) {
		return { error: `ファイルを開けませんでした: ${args.file_path}` };
	}

	if (args.symbol) {
		const found = findSymbol(await outlineOf(document.uri), args.symbol);
		if (found) {
			const at = symbolPosition(found);
			return { document, position: new vscode.Position(at.line, at.character) };
		}
		// アウトラインを持たない言語（設定ファイル・未対応の拡張子）向けの保険
		const inText = positionInText(document.getText(), args.symbol);
		if (inText) {
			return { document, position: new vscode.Position(inText.line, inText.character) };
		}
		const outline = await outlineOf(document.uri);
		const names = outline.map((symbol) => symbol.name).slice(0, 30);
		return {
			error:
				`${args.symbol} が ${displayPath(workspaceRoots(), resolved.path)} に見つかりません。` +
				(names.length > 0 ? `このファイルにあるのは: ${names.join(', ')}` : 'このファイルにはシンボルがありません。')
		};
	}

	if (args.line !== undefined) {
		const position = toPosition(args.line, args.column);
		if ('error' in position) {
			return position;
		}
		if (position.position.line >= document.lineCount) {
			return { error: `${args.line} 行目はありません（このファイルは ${document.lineCount} 行）。` };
		}
		return { document, position: new vscode.Position(position.position.line, position.position.character) };
	}

	return { error: 'symbol（名前）か line（行番号）のどちらかを指定してください。' };
}

/** 例外をそのまま投げるとツール呼び出しごと失敗するので、読める文にして返す */
async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await run();
	} catch (error) {
		return errorResult(`Nimbus: ${error instanceof Error ? error.message : String(error)}`);
	}
}

const targetArgs = {
	file_path: z.string().describe('対象のファイル。ワークスペースからの相対パスでも絶対パスでもよい'),
	symbol: z
		.string()
		.optional()
		.describe('対象のシンボル名。`Class.method` のような入れ子の指定もできる。line より優先する'),
	line: z.number().optional().describe('対象の行（1 起点。Read の出力と同じ数え方）。symbol を省いたときに使う'),
	column: z.number().optional().describe('対象の桁（1 起点。省略すると行頭）')
};

const DEFINITION_COMMANDS = {
	definition: 'vscode.executeDefinitionProvider',
	type_definition: 'vscode.executeTypeDefinitionProvider',
	implementation: 'vscode.executeImplementationProvider'
} as const;

const SERVER_INSTRUCTIONS = [
	'Nimbus（この IDE）が動かしている言語サーバーに直接問い合わせるツール群。',
	'定義・参照・型・呼び出し階層・診断を、grep より正確に、少ない読み込みで取れる。',
	'シンボルを追うときは Grep でファイルを総当たりする前にこちらを使うこと。',
	'行と桁はすべて 1 起点（Read ツールの出力と同じ数え方）。',
	'位置は symbol（名前）で指定するのが基本。分かっているときだけ line / column を使う。'
].join('\n');

function defineTools() {
	return [
		tool(
			'definition',
			'シンボルの定義位置を返す（型定義・実装にも切り替えられる）。「この関数はどこで定義されているか」に一発で答える。',
			{
				...targetArgs,
				kind: z
					.enum(['definition', 'type_definition', 'implementation'])
					.optional()
					.describe('definition=定義（既定） / type_definition=型の定義 / implementation=インターフェースの実装')
			},
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const target = await resolveTarget(args);
					if ('error' in target) {
						return errorResult(target.error);
					}
					const command = DEFINITION_COMMANDS[args.kind ?? 'definition'];
					const found = await runListCommand<vscode.Location | vscode.LocationLink>(
						command,
						target.document.uri,
						target.position
					);
					const entries = await toEntries(toLocations(found), RESULT_LIMIT);
					return textResult(renderLocations(workspaceRoots(), entries, RESULT_LIMIT));
				})
		),

		tool(
			'references',
			'シンボルを参照している箇所をすべて返す。各行のソースも添えるので、どんな使われ方かがそのまま読める。',
			targetArgs,
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const target = await resolveTarget(args);
					if ('error' in target) {
						return errorResult(target.error);
					}
					const found = await runListCommand<vscode.Location>(
						'vscode.executeReferenceProvider',
						target.document.uri,
						target.position
					);
					const entries = await toEntries(
						found.map((location) => ({ uri: location.uri, range: location.range })),
						RESULT_LIMIT
					);
					const header = `参照 ${found.length} 件`;
					return textResult(`${header}\n${renderLocations(workspaceRoots(), entries, RESULT_LIMIT)}`);
				})
		),

		tool(
			'hover',
			'その位置の型・シグネチャ・ドキュメントを返す。存在しない引数や戻り値を思い込みで書く前に、これで実物を確かめる。',
			targetArgs,
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const target = await resolveTarget(args);
					if ('error' in target) {
						return errorResult(target.error);
					}
					const hovers = await runListCommand<vscode.Hover>(
						'vscode.executeHoverProvider',
						target.document.uri,
						target.position
					);
					const parts = hovers.flatMap((hover) =>
						hover.contents.map((content) => (typeof content === 'string' ? content : content.value))
					);
					return textResult(renderHover(parts));
				})
		),

		tool(
			'document_symbols',
			'ファイルのアウトライン（クラス・関数・メソッドの一覧と行範囲）を入れ子のまま返す。全文を読まずに構造だけ掴みたいときに使う。',
			{ file_path: targetArgs.file_path },
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const resolved = resolveWorkspacePath(workspaceRoots(), args.file_path);
					if ('error' in resolved) {
						return errorResult(resolved.error);
					}
					const outline = await outlineOf(vscode.Uri.file(resolved.path));
					if (outline.length === 0) {
						return textResult('（この言語ではアウトラインを取得できませんでした）');
					}
					return textResult(renderOutline(outline));
				})
		),

		tool(
			'workspace_symbols',
			'プロジェクト全体からシンボルを名前で探す。どのファイルにあるか分からないときの入口。',
			{
				query: z.string().describe('探すシンボル名（部分一致でよい）'),
				limit: z.number().optional().describe(`返す件数の上限（既定 ${RESULT_LIMIT}）`)
			},
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const found = await runListCommand<vscode.SymbolInformation>(
						'vscode.executeWorkspaceSymbolProvider',
						args.query
					);
					const limit = Math.max(1, Math.min(args.limit ?? RESULT_LIMIT, 200));
					const roots = workspaceRoots();
					const lines = found
						.slice(0, limit)
						.map((symbol) => {
							const where = `${displayPath(roots, symbol.location.uri.fsPath)}:${symbol.location.range.start.line + 1}`;
							const container = symbol.containerName ? `${symbol.containerName}.` : '';
							return `${symbolKindLabel(symbol.kind)} ${container}${symbol.name}  ${where}`;
						});
					if (lines.length === 0) {
						return textResult('（見つかりませんでした）');
					}
					const omitted = found.length - lines.length;
					return textResult(omitted > 0 ? [...lines, `…他 ${omitted} 件`].join('\n') : lines.join('\n'));
				})
		),

		tool(
			'call_hierarchy',
			'呼び出し階層を返す。incoming=この関数を呼んでいるところ / outgoing=この関数が呼んでいるところ。変更の影響範囲を測るときに使う。',
			{
				...targetArgs,
				direction: z.enum(['incoming', 'outgoing']).describe('incoming=呼び出し元 / outgoing=呼び出し先')
			},
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const target = await resolveTarget(args);
					if ('error' in target) {
						return errorResult(target.error);
					}
					const items = await runListCommand<vscode.CallHierarchyItem>(
						'vscode.prepareCallHierarchy',
						target.document.uri,
						target.position
					);
					if (items.length === 0) {
						return textResult('（この位置では呼び出し階層を取得できませんでした）');
					}
					const roots = workspaceRoots();
					const lines: string[] = [];
					if (args.direction === 'incoming') {
						const calls = await runListCommand<vscode.CallHierarchyIncomingCall>(
							'vscode.provideIncomingCalls',
							items[0]
						);
						for (const call of calls.slice(0, RESULT_LIMIT)) {
							lines.push(describeHierarchyItem(roots, call.from, call.fromRanges.length));
						}
					} else {
						const calls = await runListCommand<vscode.CallHierarchyOutgoingCall>(
							'vscode.provideOutgoingCalls',
							items[0]
						);
						for (const call of calls.slice(0, RESULT_LIMIT)) {
							lines.push(describeHierarchyItem(roots, call.to, call.fromRanges.length));
						}
					}
					if (lines.length === 0) {
						return textResult(args.direction === 'incoming' ? '（呼び出し元はありません）' : '（呼び出し先はありません）');
					}
					return textResult(`${items[0].name} の${args.direction === 'incoming' ? '呼び出し元' : '呼び出し先'}\n${lines.join('\n')}`);
				})
		),

		tool(
			'diagnostics',
			'型エラー・lint の指摘を返す。コードを直したあと、テストを回す前にこれで確かめる。file_path を省くとワークスペース全体。',
			{
				file_path: z.string().optional().describe('対象のファイル。省略するとワークスペース全体'),
				severity: z
					.enum(['error', 'warning', 'all'])
					.optional()
					.describe('error=エラーのみ（既定） / warning=警告以上 / all=すべて')
			},
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const roots = workspaceRoots();
					let collected: [vscode.Uri, readonly vscode.Diagnostic[]][];
					if (args.file_path) {
						const resolved = resolveWorkspacePath(roots, args.file_path);
						if ('error' in resolved) {
							return errorResult(resolved.error);
						}
						const uri = vscode.Uri.file(resolved.path);
						// 開いていないファイルは言語サーバーがまだ見ていない。開いてから取る
						await openDocument(uri);
						collected = [[uri, vscode.languages.getDiagnostics(uri)]];
					} else {
						collected = vscode.languages.getDiagnostics().map(([uri, list]) => [uri, list]);
					}

					const maxSeverity = args.severity === 'all' ? 3 : args.severity === 'warning' ? 1 : 0;
					const lines: string[] = [];
					let total = 0;
					for (const [uri, list] of collected) {
						for (const diagnostic of list) {
							if (diagnostic.severity > maxSeverity) {
								continue;
							}
							total++;
							if (lines.length >= RESULT_LIMIT) {
								continue;
							}
							const where = `${displayPath(roots, uri.fsPath)}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`;
							const source = diagnostic.source ? ` (${diagnostic.source})` : '';
							lines.push(`${where}  [${severityLabel(diagnostic.severity)}]${source} ${diagnostic.message}`);
						}
					}
					if (total === 0) {
						return textResult('（指摘はありません）');
					}
					const omitted = total - lines.length;
					return textResult(omitted > 0 ? [...lines, `…他 ${omitted} 件`].join('\n') : lines.join('\n'));
				})
		)
	];
}

function describeHierarchyItem(roots: readonly string[], item: vscode.CallHierarchyItem, count: number): string {
	const where = `${displayPath(roots, item.uri.fsPath)}:${item.selectionRange.start.line + 1}`;
	const times = count > 1 ? ` ×${count}` : '';
	return `${symbolKindLabel(item.kind)} ${item.name}  ${where}${times}`;
}

let cached: McpSdkServerConfigWithInstance | undefined;

/**
 * セッションに渡す MCP サーバー。1 つ作って全セッションで共有する
 * （中で持っているのはツールの定義だけで、セッション固有の状態は無い）。
 */
export function lspMcpServer(): McpSdkServerConfigWithInstance {
	cached ??= createSdkMcpServer({
		name: LSP_SERVER_NAME,
		version: '0.1.0',
		instructions: SERVER_INSTRUCTIONS,
		tools: defineTools(),
		// 探しに行かないと見つからない状態だと、結局 grep に流れてしまう
		alwaysLoad: true
	});
	return cached;
}
