/**
 * 指示で名指しされた API の、実物のシグネチャを添える（tasks.md T-175）。
 *
 * 「`SessionManager.createSession` を直して」と書いたとき、エージェントはまず
 * その関数を探すところから始める。フォークの中では言語サーバーが答えを持っているので、
 * **送る前に実物を添えて**しまえば、探す往復も、思い込みで存在しない引数を書く事故も減る。
 *
 * 添付したことは指示の中に見出しつきで残す。何が文脈に入ったかを説明できない状態にしない。
 */
import * as vscode from 'vscode';
import { displayPath } from './core/lsp';
import {
	DEFAULT_MENTION_LIMIT,
	extractSymbolMentions,
	renderSignatureNote,
	signatureFromHover,
	type SignatureNote
} from './core/mentions';

/** 送信を待たせてよい時間。ここが長いと入力の手応えが鈍る */
const BUDGET_MS = 2500;

function roots(): string[] {
	return (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
}

async function resolveOne(mention: string): Promise<SignatureNote | undefined> {
	// `Class.method` は末尾の名前で引く（ワークスペース検索は入れ子の経路を知らない）
	const last = mention.split('.').pop() ?? mention;
	const symbols =
		(await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
			'vscode.executeWorkspaceSymbolProvider',
			last
		)) ?? [];
	const exact = symbols.find((symbol) => symbol.name === last) ?? symbols[0];
	if (!exact) {
		return undefined;
	}
	const hovers =
		(await vscode.commands.executeCommand<vscode.Hover[]>(
			'vscode.executeHoverProvider',
			exact.location.uri,
			exact.location.range.start
		)) ?? [];
	const text = hovers
		.flatMap((hover) => hover.contents.map((content) => (typeof content === 'string' ? content : content.value)))
		.join('\n');
	const signature = signatureFromHover(text);
	if (signature.length === 0) {
		return undefined;
	}
	return {
		mention,
		where: `${displayPath(roots(), exact.location.uri.fsPath)}:${exact.location.range.start.line + 1}`,
		signature
	};
}

/**
 * 指示に添える文。何も解決できなければ `undefined`（何も足さない）。
 *
 * 時間切れのときも黙って諦める — 添付は「あると嬉しい」ものであって、
 * これのために送信が詰まるのは本末転倒。
 */
export async function buildSignatureNote(text: string): Promise<string | undefined> {
	const config = vscode.workspace.getConfiguration('nimbus');
	if (config.get<boolean>('lsp.attachSignatures') === false || roots().length === 0) {
		return undefined;
	}
	const limit = config.get<number>('lsp.maxAttachedSignatures') ?? DEFAULT_MENTION_LIMIT;
	const mentions = extractSymbolMentions(text, limit);
	if (mentions.length === 0) {
		return undefined;
	}

	const resolved = await Promise.race([
		Promise.all(mentions.map((mention) => resolveOne(mention).catch(() => undefined))),
		new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), BUDGET_MS))
	]);
	if (!resolved) {
		return undefined;
	}
	const note = renderSignatureNote(resolved.filter((entry): entry is SignatureNote => entry !== undefined));
	return note.length > 0 ? note : undefined;
}
