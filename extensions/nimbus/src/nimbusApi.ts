/**
 * 他の拡張へ渡す口（tasks.md T-092）。
 *
 * `activate()` の戻り値として公開する。使う側はこう書く:
 *
 * ```ts
 * const nimbus = vscode.extensions.getExtension('nimbus.nimbus')?.exports as NimbusApi | undefined;
 * const registration = nimbus?.registerContext('acme.tools', {
 *   kind: 'context', id: 'branch', label: 'ブランチの決まり'
 * }, () => 'main へ直接 push しない');
 * context.subscriptions.push(registration);
 * ```
 *
 * **足せるのは「読ませるもの」と「作らせるもの」だけ。**
 * 権限の判断には触らせない（`core/pluginApi.ts` の方針を見よ）。
 *
 * 判断と検査は `core/pluginApi.ts`。ここは VS Code との接続だけ。
 */
import * as vscode from 'vscode';
import {
	clampContext,
	formatContext,
	validate,
	type PluginContribution,
	type RegisteredContribution
} from './core/pluginApi';

/** 文脈を作る側の関数。**同期で返せないものは渡さない**（送信を待たせないため） */
export type ContextProvider = () => string | Promise<string>;

/** 定型の指示を作る側の関数 */
export type ActionProvider = () => string | Promise<string>;

export interface NimbusApi {
	/** この API の形。**増やすときは上げる**（使う側が分岐できるように） */
	readonly version: 1;
	/** セッションへ渡す前提を足す */
	registerContext(extensionId: string, contribution: PluginContribution, provider: ContextProvider): vscode.Disposable;
	/** コックピットから呼べる指示を足す */
	registerAction(extensionId: string, contribution: PluginContribution, provider: ActionProvider): vscode.Disposable;
	/** いま何が登録されているか（画面と切り分けのため） */
	contributions(): readonly RegisteredContribution[];
}

interface Entry {
	registered: RegisteredContribution;
	provider: ContextProvider | ActionProvider;
}

/** 1 つの拡張が返らないせいで送信が止まらないようにする */
const PROVIDER_TIMEOUT_MS = 2_000;

async function callProvider(entry: Entry, log: (message: string) => void): Promise<string> {
	try {
		const value = await Promise.race([
			Promise.resolve(entry.provider()),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error(`${PROVIDER_TIMEOUT_MS} ms で返りませんでした`)), PROVIDER_TIMEOUT_MS)
			)
		]);
		return typeof value === 'string' ? value : '';
	} catch (error) {
		// 拡張が転んでも Nimbus は止めない。ただし黙らない
		const message = error instanceof Error ? error.message : String(error);
		log(`[plugin] ${entry.registered.qualifiedId} が失敗しました: ${message}`);
		return '';
	}
}

export class NimbusApiHost implements NimbusApi {
	readonly version = 1 as const;
	private readonly entries = new Map<string, Entry>();

	constructor(private readonly log: (message: string) => void) { }

	private register(
		extensionId: string,
		contribution: PluginContribution,
		provider: ContextProvider | ActionProvider
	): vscode.Disposable {
		const result = validate(extensionId, contribution, [...this.entries.values()].map((e) => e.registered));
		if (!result.ok) {
			// 例外にする。黙って無視すると、拡張を書いている人が気づけない
			throw new Error(`Nimbus: ${result.reason}`);
		}
		const { registered } = result;
		this.entries.set(registered.qualifiedId, { registered, provider });
		this.log(`[plugin] 登録: ${registered.qualifiedId}（${registered.kind}）`);
		return new vscode.Disposable(() => {
			this.entries.delete(registered.qualifiedId);
			this.log(`[plugin] 解除: ${registered.qualifiedId}`);
		});
	}

	registerContext(extensionId: string, contribution: PluginContribution, provider: ContextProvider): vscode.Disposable {
		return this.register(extensionId, { ...contribution, kind: 'context' }, provider);
	}

	registerAction(extensionId: string, contribution: PluginContribution, provider: ActionProvider): vscode.Disposable {
		return this.register(extensionId, { ...contribution, kind: 'action' }, provider);
	}

	contributions(): readonly RegisteredContribution[] {
		return [...this.entries.values()].map((entry) => entry.registered);
	}

	/**
	 * 拡張が足した前提を集めて、セッションへ渡す文にする。
	 * **1 つが枠を食い尽くさないように、拡張ごとに切る。**
	 */
	async collectContext(): Promise<string> {
		const contexts = [...this.entries.values()].filter((entry) => entry.registered.kind === 'context');
		if (contexts.length === 0) {
			return '';
		}
		const parts = await Promise.all(
			contexts.map(async (entry) => ({
				qualifiedId: entry.registered.qualifiedId,
				label: entry.registered.label,
				text: clampContext(await callProvider(entry, this.log))
			}))
		);
		return formatContext(parts);
	}

	/** 拡張が足した指示を選んで、その文を返す */
	async pickAction(): Promise<string | undefined> {
		const actions = [...this.entries.values()].filter((entry) => entry.registered.kind === 'action');
		if (actions.length === 0) {
			void vscode.window.showInformationMessage('Nimbus: 拡張が足した指示はまだありません。');
			return undefined;
		}
		const picked = await vscode.window.showQuickPick(
			actions.map((entry) => ({
				label: entry.registered.label,
				description: entry.registered.qualifiedId,
				detail: entry.registered.description,
				entry
			})),
			{ title: '拡張が足した指示', placeHolder: '送る指示を選んでください', matchOnDescription: true }
		);
		if (!picked) {
			return undefined;
		}
		const text = await callProvider(picked.entry, this.log);
		if (text.trim().length === 0) {
			void vscode.window.showWarningMessage(`Nimbus: ${picked.entry.registered.qualifiedId} は何も返しませんでした。`);
			return undefined;
		}
		return text;
	}
}
