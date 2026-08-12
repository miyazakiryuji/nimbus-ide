/**
 * MCP ツールの単体実行（tasks.md T-235）。
 *
 * エージェントを介さず、**ツールを 1 回だけ呼ぶ**。
 * これができないと、ツールが返さないときに
 * 「エージェントが呼び方を間違えた」のか「ツールが壊れている」のかが切り分けられない。
 *
 * Nimbus 自身のツール（`nimbus_lsp` / `nimbus_debug`）は**プロセス内**にいるので、
 * メモリ内の経路で繋ぐ。API も課金も発生しない。
 *
 * 引数の組み立ては `core/mcpArgs.ts`。ここは繋ぎと画面だけ。
 */
import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { buildArgs, describeResult, toFields, type ArgField, type JsonSchema } from './core/mcpArgs';

export interface McpToolRunnerDeps {
	log: (message: string) => void;
	/** プロセス内で動いている Nimbus 自身の MCP サーバー */
	servers: () => { name: string; config: McpSdkServerConfigWithInstance }[];
}

interface ListedTool {
	name: string;
	description?: string;
	inputSchema?: JsonSchema;
}

/**
 * プロセス内のサーバーへ繋ぐ。
 * 返した `Client` は**必ず閉じる** — 開きっぱなしにすると
 * サーバー側にトランスポートが溜まる。
 */
async function connectInProcess(server: McpSdkServerConfigWithInstance): Promise<Client> {
	const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
	const client = new Client({ name: 'nimbus-tool-runner', version: '0.1.0' });
	await server.instance.connect(serverSide);
	await client.connect(clientSide);
	return client;
}

/** 引数をひとつずつ聞く。**途中で閉じたら実行しない**（空で呼ぶと事故になる） */
async function askArgs(tool: ListedTool, fields: readonly ArgField[]): Promise<Map<string, string> | undefined> {
	const entered = new Map<string, string>();
	for (const [index, field] of fields.entries()) {
		const title = `${tool.name} — ${index + 1}/${fields.length}`;
		const label = `${field.name}: ${field.type}${field.required ? '（必須）' : '（任意・空で飛ばす）'}`;
		let value: string | undefined;
		if (field.choices && field.choices.length > 0) {
			const picked = await vscode.window.showQuickPick(
				field.required ? field.choices : ['（入れない）', ...field.choices],
				{ title, placeHolder: label }
			);
			if (picked === undefined) {
				return undefined;
			}
			value = picked === '（入れない）' ? '' : picked;
		} else {
			value = await vscode.window.showInputBox({
				title,
				prompt: field.description ?? label,
				placeHolder: field.placeholder ?? label,
				value: field.placeholder,
				ignoreFocusOut: true
			});
			if (value === undefined) {
				return undefined;
			}
		}
		entered.set(field.name, value);
	}
	return entered;
}

/** ツールを 1 回だけ呼ぶ */
export async function runMcpToolOnce(deps: McpToolRunnerDeps): Promise<void> {
	const servers = deps.servers();
	if (servers.length === 0) {
		void vscode.window.showInformationMessage(
			'Nimbus: 単体で呼べる MCP サーバーがありません。'
			+ '`nimbus.lspTools` / `nimbus.debugTools` を有効にすると、その場で試せます。'
		);
		return;
	}

	const serverPick = servers.length === 1
		? servers[0]
		: await vscode.window
			.showQuickPick(
				servers.map((server) => ({ label: server.name, server })),
				{ title: 'MCP ツールを試す', placeHolder: 'どのサーバーのツールを呼びますか' }
			)
			.then((picked) => picked?.server);
	if (!serverPick) {
		return;
	}

	let client: Client | undefined;
	try {
		client = await connectInProcess(serverPick.config);
		const listed = await client.listTools();
		const tools = listed.tools as ListedTool[];
		if (tools.length === 0) {
			void vscode.window.showInformationMessage(`Nimbus: ${serverPick.name} にツールがありません。`);
			return;
		}

		const toolPick = await vscode.window.showQuickPick(
			tools.map((tool) => ({
				label: tool.name,
				detail: tool.description?.split('\n')[0],
				tool
			})),
			{ title: `${serverPick.name} のツール`, placeHolder: '1 回だけ呼ぶツールを選んでください', matchOnDetail: true }
		);
		if (!toolPick) {
			return;
		}

		const fields = toFields(toolPick.tool.inputSchema);
		const entered = fields.length === 0 ? new Map<string, string>() : await askArgs(toolPick.tool, fields);
		if (!entered) {
			return;
		}
		const built = buildArgs(fields, entered);
		if (!built.ok) {
			void vscode.window.showWarningMessage(`Nimbus: ${built.reason}`);
			return;
		}

		deps.log(`[mcp] ${serverPick.name}/${toolPick.tool.name} を単体実行します`);
		const startedAt = Date.now();
		const result = await vscode.window.withProgress(
			{ location: vscode.ProgressLocation.Notification, title: `${toolPick.tool.name} を呼んでいます…` },
			() => client!.callTool({ name: toolPick.tool.name, arguments: built.args })
		);
		const elapsed = Date.now() - startedAt;

		const body = [
			`# ${serverPick.name} / ${toolPick.tool.name}`,
			'',
			'## 渡した引数',
			'',
			'```json',
			JSON.stringify(built.args, null, 2),
			'```',
			'',
			'## 返ってきたもの',
			'',
			describeResult(result, elapsed)
		].join('\n');
		deps.log(`[mcp] ${toolPick.tool.name} — ${result.isError ? '失敗' : '成功'}（${elapsed} ms）`);
		const document = await vscode.workspace.openTextDocument({ content: body, language: 'markdown' });
		await vscode.window.showTextDocument(document, { preview: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		deps.log(`[mcp] 単体実行に失敗しました: ${message}`);
		void vscode.window.showErrorMessage(`Nimbus: MCP ツールの実行に失敗しました — ${message}`);
	} finally {
		// 繋いだままにするとサーバー側にトランスポートが残る
		await client?.close().catch(() => undefined);
	}
}
