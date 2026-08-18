/**
 * デバッガをエージェントのツールにする（tasks.md T-104）。
 *
 * ブレークポイントで止めた状態の**コールスタックと変数の値**を渡す。
 * ソースをいくら読ませても「この変数が null になっている」は分からない。
 * デバッグアダプタはこのプロセスの隣にいるので、DAP の応答をそのまま渡せばいい。
 *
 * **読むだけ。** 式の評価（`evaluate`）は入れていない — 式は副作用を持ちうるのに、
 * `mcp__nimbus_` は承認を通らずに実行される（`permissions.ts`）。
 * 「値を見る」と「コードを走らせる」を同じ扱いにはしない。
 */
import * as vscode from 'vscode';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { displayPath } from './core/lsp';
import {
	NOT_STOPPED,
	renderScopes,
	renderStack,
	type ScopeLike,
	type StackFrameLike
} from './core/debugState';

/** MCP サーバー名。ツール名は `mcp__nimbus_debug__<tool>` になる */
export const DEBUG_SERVER_NAME = 'nimbus_debug';

/** 一度に返すフレーム数。深い再帰を丸ごと渡しても読めない */
const MAX_FRAMES = 20;
/** 1 スコープあたりの変数の数 */
const MAX_VARIABLES = 40;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

function textResult(text: string): ToolResult {
	return { content: [{ type: 'text', text }] };
}

function roots(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

interface StoppedAt {
	session: vscode.DebugSession;
	threadId: number;
	/** 利用者がデバッグビューで選んでいるフレーム（あれば） */
	frameId?: number;
}

/**
 * いま止まっている場所。
 * `activeStackItem` は「止まっているときだけ」立つので、これで停止判定を兼ねる。
 */
function stoppedAt(): StoppedAt | undefined {
	const item = vscode.debug.activeStackItem;
	if (!item) {
		return undefined;
	}
	return {
		session: item.session,
		threadId: item.threadId,
		frameId: 'frameId' in item ? item.frameId : undefined
	};
}

interface DapStackFrame {
	id: number;
	name: string;
	line?: number;
	column?: number;
	source?: { path?: string };
}

async function fetchFrames(at: StoppedAt): Promise<DapStackFrame[]> {
	const response = (await at.session.customRequest('stackTrace', {
		threadId: at.threadId,
		startFrame: 0,
		levels: MAX_FRAMES
	})) as { stackFrames?: DapStackFrame[] } | undefined;
	return response?.stackFrames ?? [];
}

function toFrame(frame: DapStackFrame): StackFrameLike {
	return { name: frame.name, file: frame.source?.path, line: frame.line, column: frame.column };
}

async function fetchScopes(session: vscode.DebugSession, frameId: number): Promise<ScopeLike[]> {
	const response = (await session.customRequest('scopes', { frameId })) as
		| { scopes?: { name: string; variablesReference: number; expensive?: boolean }[] }
		| undefined;
	const scopes: ScopeLike[] = [];
	for (const scope of response?.scopes ?? []) {
		// expensive なスコープ（グローバル全体など）は開かない。止まるほど重いことがある
		if (scope.expensive || scope.variablesReference === 0) {
			continue;
		}
		const variables = (await session.customRequest('variables', {
			variablesReference: scope.variablesReference
		})) as { variables?: { name: string; value: string; type?: string }[] } | undefined;
		scopes.push({
			name: scope.name,
			variables: (variables?.variables ?? [])
				.slice(0, MAX_VARIABLES)
				.map((variable) => ({ name: variable.name, value: variable.value, type: variable.type }))
		});
	}
	return scopes;
}

async function guard(run: () => Promise<ToolResult>): Promise<ToolResult> {
	try {
		return await run();
	} catch (error) {
		return {
			content: [{ type: 'text', text: `Nimbus: ${error instanceof Error ? error.message : String(error)}` }],
			isError: true
		};
	}
}

const SERVER_INSTRUCTIONS = [
	'Nimbus（この IDE）が繋いでいるデバッガの状態を読むツール。',
	'ブレークポイントで止まっているときだけ答えられる。',
	'「実行時に実際どうなっているか」を知りたいときは、ソースを読み直す前にこちらを使う。',
	'読むだけで、式の評価やステップ実行はできない。'
].join('\n');

function defineTools() {
	return [
		tool(
			'debug_stack',
			'いま停止しているデバッグセッションのコールスタックを返す。どこから呼ばれてここに来たのかが分かる。',
			{},
			async (): Promise<ToolResult> =>
				guard(async () => {
					const at = stoppedAt();
					if (!at) {
						return textResult(NOT_STOPPED);
					}
					const frames = (await fetchFrames(at)).map(toFrame);
					const where = roots();
					return textResult(
						`セッション: ${at.session.name}（${at.session.type}）\n${renderStack(frames, (file) => displayPath(where, file))}`
					);
				})
		),

		tool(
			'debug_variables',
			'停止している位置で見えている変数の名前・型・値を返す。「この変数が実際どうなっているか」に答える。',
			{
				frame: z
					.number()
					.optional()
					.describe('コールスタックの何番目のフレームを見るか（debug_stack の #番号。既定は止まっている一番上）')
			},
			async (args): Promise<ToolResult> =>
				guard(async () => {
					const at = stoppedAt();
					if (!at) {
						return textResult(NOT_STOPPED);
					}
					const frames = await fetchFrames(at);
					if (frames.length === 0) {
						return textResult('（コールスタックを取得できませんでした）');
					}
					const index = args.frame ?? 0;
					if (index < 0 || index >= frames.length) {
						return textResult(`フレーム #${index} はありません（0 〜 ${frames.length - 1}）。`);
					}
					// 引数が無いときは、利用者がデバッグビューで選んでいるフレームを優先する
					const frameId = args.frame === undefined ? (at.frameId ?? frames[0].id) : frames[index].id;
					const chosen = frames.find((frame) => frame.id === frameId) ?? frames[index];
					const scopes = await fetchScopes(at.session, frameId);
					const where = chosen.source?.path
						? `${displayPath(roots(), chosen.source.path)}${chosen.line === undefined ? '' : `:${chosen.line}`}`
						: '';
					return textResult(`${chosen.name}  ${where}\n\n${renderScopes(scopes)}`);
				})
		)
	];
}

/**
 * いま止まっている場所を、そのままセッションへ渡せる形にする（T-254）。
 *
 * MCP のツール（T-104）は **Claude 側から取りに行く**口。こちらは **こちらから渡す**口で、
 * 例外やテスト失敗で止まったときに、聞かれる前にその場の事実を差し出すためのもの。
 * 止まっていなければ undefined。
 */
export async function stoppedSnapshot(): Promise<{ where: string; text: string } | undefined> {
	const at = stoppedAt();
	if (!at) {
		return undefined;
	}
	const frames = await fetchFrames(at);
	if (frames.length === 0) {
		return undefined;
	}
	const frameId = at.frameId ?? frames[0].id;
	const chosen = frames.find((frame) => frame.id === frameId) ?? frames[0];
	const scopes = await fetchScopes(at.session, frameId);
	const where = roots();
	const at_ = chosen.source?.path
		? `${displayPath(where, chosen.source.path)}${chosen.line === undefined ? '' : `:${chosen.line}`}`
		: chosen.name;
	return {
		where: at_,
		text: [
			`デバッガが ${at_} で止まっています（${at.session.name} / ${at.session.type}）。`,
			'',
			'## コールスタック',
			'',
			renderStack(frames.map(toFrame), (file) => displayPath(where, file)),
			'',
			'## その場の変数',
			'',
			renderScopes(scopes)
		].join('\n')
	};
}

let cached: McpSdkServerConfigWithInstance | undefined;

/** セッションに渡す MCP サーバー。ツールの定義しか持たないので 1 つを共有する */
export function debugMcpServer(): McpSdkServerConfigWithInstance {
	cached ??= createSdkMcpServer({
		name: DEBUG_SERVER_NAME,
		version: '0.1.0',
		instructions: SERVER_INSTRUCTIONS,
		tools: defineTools(),
		alwaysLoad: true
	});
	return cached;
}
