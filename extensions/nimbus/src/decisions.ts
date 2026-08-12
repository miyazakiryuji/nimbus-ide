/**
 * 決めたことを ADR として残す（tasks.md T-060）。
 *
 * 設計の判断は会話の中で決まって、会話と一緒に消える。
 * 半年後に「なぜこうなっているのか」を誰も説明できないのは、この取りこぼしが原因。
 *
 * Nimbus がやるのは**置き場所と型を用意すること**と、**会話から候補を拾うこと**。
 * 「なぜそう決めたか」を書くのはセッション側 — 理由の無い記録は、次に読む人を縛るだけ。
 */
import { writeFile } from 'fs/promises';
import * as vscode from 'vscode';
import { adrFileName, buildAdrPrompt, extractDecisions, nextAdrNumber, renderAdr } from './core/decisions';
import { pickWorkspaceRoot } from './workspaceRoots';

/** ADR の置き場所。仕様書（`specs/`）とは分ける — 判断の記録は時系列で積む */
const ADR_DIR = ['nimbus', 'docs', 'decisions'];

export interface DecisionsDeps {
	/** 会話の本文（新しい順でなくてよい） */
	transcript: () => string[];
	/** きっかけになった指示 */
	instructions: () => string[];
	send: (text: string) => void;
	log: (message: string) => void;
	/** 日付（テスト用に差し替えられるように） */
	today?: () => string;
}

/** 会話から ADR の下書きを作り、理由を埋めさせる */
export async function writeAdr(deps: DecisionsDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const title = await vscode.window.showInputBox({
		title: 'Nimbus: 決めたことを残す（ADR）',
		prompt: '何についての判断か',
		placeHolder: '例: 認証方式'
	});
	if (!title) {
		return;
	}

	const dir = vscode.Uri.joinPath(folder.uri, ...ADR_DIR);
	await vscode.workspace.fs.createDirectory(dir);
	const decisions = extractDecisions(deps.transcript());
	const date = (deps.today ?? (() => new Date().toISOString().slice(0, 10)))();

	const created = await createNumbered(dir, title, (numbered) =>
		renderAdr({ number: numbered, title, date, decisions, instructions: deps.instructions().slice(-5) })
	);
	if (!created) {
		void vscode.window.showErrorMessage('Nimbus: ADR の番号を確保できませんでした（もう一度試してください）。');
		return;
	}

	await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(created.uri));
	deps.log(`[adr] ${created.name} を作りました（候補 ${decisions.length} 件）`);

	const FILL = '理由を埋めさせる';
	const choice = await vscode.window.showInformationMessage(
		`Nimbus: ADR の下書きを作りました（候補 ${decisions.length} 件）。「なぜ」と「選ばなかった案」が空欄です。`,
		FILL
	);
	if (choice === FILL) {
		deps.send(buildAdrPrompt(decisions, [...ADR_DIR, created.name].join('/'), title));
	}
}

/** 番号が衝突しないまで試す回数。並行しているセッションの数より十分多くとる */
const NUMBER_ATTEMPTS = 20;

/**
 * 番号を確保してファイルを作る。
 *
 * **「最大番号を読む」と「書く」の間に他のセッションが入る。** いまこの作業ツリーは
 * 5 セッションで共有されていて、実際にこの隙間で事故が起きている。
 * `wx`（既にあれば失敗）で作り、失敗したら番号を取り直す — 確保はファイル作成そのものに任せる。
 */
async function createNumbered(
	dir: vscode.Uri,
	title: string,
	body: (numbered: number) => string
): Promise<{ uri: vscode.Uri; name: string } | undefined> {
	for (let attempt = 0; attempt < NUMBER_ATTEMPTS; attempt++) {
		let existing: string[] = [];
		try {
			existing = (await vscode.workspace.fs.readDirectory(dir)).map(([name]) => name);
		} catch {
			// まだ無ければこれが 1 本目
		}
		const numbered = nextAdrNumber(existing) + attempt;
		const name = adrFileName(numbered, title);
		const uri = vscode.Uri.joinPath(dir, name);
		try {
			await writeFile(uri.fsPath, body(numbered), { flag: 'wx' });
			return { uri, name };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
				throw error;
			}
			// 誰かに取られた。番号を取り直す
		}
	}
	return undefined;
}
