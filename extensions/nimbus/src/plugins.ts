/**
 * プラグインの一覧と、有効／無効（tasks.md T-032）。
 *
 * 読むのは自前、**変えるのは `claude plugin` に任せる**。
 * 取得や検証を持っているのは CLI の側で、設定ファイルを横から書き換えると壊せてしまう。
 */
import { execFile } from 'child_process';
import { homedir } from 'os';
import * as vscode from 'vscode';
import {
	APPLIES_NEXT_SESSION,
	commandFor,
	describeRow,
	mergePlugins,
	parseCatalog,
	parseEnabled,
	parseInstalled,
	stateOf,
	type PluginRow
} from './core/plugins';

export interface PluginsDeps {
	log: (message: string) => void;
	/** 差し替え可能にしておく（テストとホーム以外の場所のため） */
	home?: string;
}

async function readText(uri: vscode.Uri): Promise<string> {
	try {
		return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
	} catch {
		return '';
	}
}

function claude(args: string[]): Promise<{ ok: boolean; output: string }> {
	return new Promise((resolve) => {
		execFile('claude', args, { maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) =>
			resolve({ ok: !error, output: (stdout + stderr).trim() })
		);
	});
}

/** 目録は marketplace ごとに 1 ファイル */
async function readCatalog(root: vscode.Uri): Promise<PluginRow[]> {
	const marketplaces = vscode.Uri.joinPath(root, 'plugins', 'marketplaces');
	let entries: [string, vscode.FileType][];
	try {
		entries = await vscode.workspace.fs.readDirectory(marketplaces);
	} catch {
		return [];
	}
	const rows = await Promise.all(
		entries
			.filter(([, type]) => type === vscode.FileType.Directory)
			.map(async ([name]) =>
				parseCatalog(
					await readText(vscode.Uri.joinPath(marketplaces, name, '.claude-plugin', 'marketplace.json')),
					name
				)
			)
	);
	return rows.flat();
}

async function loadRows(root: vscode.Uri): Promise<PluginRow[]> {
	const [installed, settings, catalog] = await Promise.all([
		readText(vscode.Uri.joinPath(root, 'plugins', 'installed_plugins.json')),
		readText(vscode.Uri.joinPath(root, 'settings.json')),
		readCatalog(root)
	]);
	return mergePlugins(parseInstalled(installed), parseEnabled(settings), catalog);
}

interface PluginPick extends vscode.QuickPickItem {
	row?: PluginRow;
	install?: boolean;
}

/** 入れていないものは数が多い（目録まるごと）ので、別の一覧にする */
async function pickToInstall(rows: readonly PluginRow[]): Promise<PluginRow | undefined> {
	const candidates = rows.filter((row) => stateOf(row) === 'not-installed');
	if (candidates.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 目録に、まだ入れていないプラグインはありません。');
		return undefined;
	}
	const picked = await vscode.window.showQuickPick<PluginPick>(
		candidates.map((row) => ({ ...describeRow(row), row })),
		{ title: `入れるプラグインを選ぶ（${candidates.length}）`, matchOnDetail: true }
	);
	return picked?.row;
}

export async function managePlugins(deps: PluginsDeps): Promise<void> {
	const root = vscode.Uri.file(`${deps.home ?? homedir()}/.claude`);
	const rows = await loadRows(root);
	if (rows.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: プラグインの情報を読めませんでした（`~/.claude` を見ています）。');
		return;
	}

	const inUse = rows.filter((row) => stateOf(row) !== 'not-installed');
	const items: PluginPick[] = [
		...inUse.map((row) => ({ ...describeRow(row), row })),
		{ label: '', kind: vscode.QuickPickItemKind.Separator },
		{ label: '$(cloud-download) 入れる…', detail: '目録から選びます', install: true }
	];

	const picked = await vscode.window.showQuickPick(items, {
		title: `プラグイン（${inUse.length}）`,
		matchOnDetail: true
	});
	if (!picked) {
		return;
	}

	const target = picked.install ? await pickToInstall(rows) : picked.row;
	if (!target) {
		return;
	}

	const { args, description } = commandFor(target);
	const answer = await vscode.window.showInformationMessage(
		`Nimbus: ${description}`,
		{ modal: false, detail: APPLIES_NEXT_SESSION },
		'実行する'
	);
	if (answer !== '実行する') {
		return;
	}

	const result = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Nimbus: ${description}` },
		() => claude(args)
	);
	deps.log(`[plugins] claude ${args.join(' ')} → ${result.ok ? 'OK' : '失敗'}`);

	if (!result.ok) {
		void vscode.window.showErrorMessage(
			`Nimbus: できませんでした。${result.output.split('\n')[0] || '`claude` コマンドが見つかりません。'}`
		);
		return;
	}
	void vscode.window.showInformationMessage(`Nimbus: ${description.replace(/します$/, 'しました')} ${APPLIES_NEXT_SESSION}`);
}
