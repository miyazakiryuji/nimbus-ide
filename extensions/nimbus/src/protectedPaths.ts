/**
 * 読ませたくないファイルを画面から指定する（tasks.md T-155）。
 *
 * 秘匿ファイルの遮断そのものは `core/secrets.ts` が持っている（T-164）。
 * ただし既定の一覧を外したり、自分の環境固有のもの（社内の鍵置き場・顧客データの CSV など）を
 * 足したりするには `settings.json` を手で書くしかなかった。
 * **危ないものほど「設定ファイルを開いて書く」の一手間で後回しにされる**ので、画面から足せるようにする。
 *
 * 保存先は設定 `nimbus.safety.protectedPaths`。既定の一覧を触りたいときは、
 * 「既定を取り込む」で丸ごと自分の設定へ写してから編集する（既定を壊さない）。
 */
import * as vscode from 'vscode';
import { DEFAULT_PROTECTED_GLOBS } from './core/secrets';

const SETTING = 'safety.protectedPaths';

interface Row extends vscode.QuickPickItem {
	action: 'add' | 'remove' | 'adopt' | 'reset';
	glob?: string;
}

function currentGlobs(): string[] {
	return vscode.workspace.getConfiguration('nimbus').get<string[]>(SETTING) ?? [];
}

async function save(globs: string[]): Promise<void> {
	// ワークスペースを開いていないこともあるので、保存先はグローバル設定にする
	await vscode.workspace.getConfiguration('nimbus').update(SETTING, globs, vscode.ConfigurationTarget.Global);
}

/**
 * 一覧を出して足す・外す。
 *
 * 既定の一覧を使っている状態（設定が空）では、既定を**読み取り専用として見せる**。
 * 何が守られているのかが分からないまま「守られているはず」と思うのが一番危ない。
 */
export async function editProtectedPaths(): Promise<void> {
	const globs = currentGlobs();
	const usingDefaults = globs.length === 0;
	const effective = usingDefaults ? [...DEFAULT_PROTECTED_GLOBS] : globs;

	const rows: Row[] = [
		{ label: '$(add) パターンを足す', detail: '例: `**/secrets/**`、`**/*.csv`', action: 'add' },
		...(usingDefaults
			? [{ label: '$(copy) 既定を取り込んで編集できるようにする', detail: `既定の ${DEFAULT_PROTECTED_GLOBS.length} 件を自分の設定へ写します`, action: 'adopt' as const }]
			: [{ label: '$(discard) 既定に戻す', detail: '自分の設定を空にして、既定の一覧を使います', action: 'reset' as const }]),
		{ label: usingDefaults ? '既定の一覧（読み取り専用）' : '自分の設定', kind: vscode.QuickPickItemKind.Separator, action: 'remove' } as Row,
		...effective.map((glob): Row => ({
			label: glob.startsWith('!') ? `$(check) ${glob.slice(1)}` : `$(shield) ${glob}`,
			description: glob.startsWith('!') ? '例外（読める）' : '読み取りを止める',
			detail: usingDefaults ? '既定の項目。編集するには先に「既定を取り込む」' : '選ぶと外します',
			action: 'remove',
			glob
		}))
	];

	const picked = await vscode.window.showQuickPick(rows, {
		title: 'Nimbus: 読ませたくないファイル',
		placeHolder: `${effective.length} 件が有効${usingDefaults ? '（既定）' : ''}`
	});
	if (!picked) {
		return;
	}

	if (picked.action === 'add') {
		const input = await vscode.window.showInputBox({
			title: 'Nimbus: 読み取りを止めるパターン',
			prompt: 'glob で書きます。先頭に ! を付けると「例外（読める）」になります',
			placeHolder: '**/secrets/**',
			validateInput: (value) => (value.trim().length === 0 ? '空にはできません' : undefined)
		});
		if (!input) {
			return;
		}
		const next = usingDefaults ? [...DEFAULT_PROTECTED_GLOBS, input.trim()] : [...globs, input.trim()];
		await save(next);
		void vscode.window.showInformationMessage(`Nimbus: 「${input.trim()}」を足しました。`);
		return;
	}

	if (picked.action === 'adopt') {
		await save([...DEFAULT_PROTECTED_GLOBS]);
		void vscode.window.showInformationMessage('Nimbus: 既定の一覧を自分の設定へ取り込みました。');
		return;
	}

	if (picked.action === 'reset') {
		await save([]);
		void vscode.window.showInformationMessage('Nimbus: 既定の一覧に戻しました。');
		return;
	}

	if (picked.action === 'remove' && picked.glob) {
		if (usingDefaults) {
			void vscode.window.showInformationMessage(
				'Nimbus: 既定の項目は直接は外せません。先に「既定を取り込んで編集できるようにする」を選んでください。'
			);
			return;
		}
		// 外すのは「読ませない」をやめる操作なので、必ず一度確認する
		const yes = '外す';
		const answer = await vscode.window.showWarningMessage(
			`「${picked.glob}」を外すと、このパターンのファイルを Claude が読めるようになります。`,
			{ modal: true },
			yes
		);
		if (answer !== yes) {
			return;
		}
		await save(globs.filter((g) => g !== picked.glob));
		void vscode.window.showInformationMessage(`Nimbus: 「${picked.glob}」を外しました。`);
	}
}
