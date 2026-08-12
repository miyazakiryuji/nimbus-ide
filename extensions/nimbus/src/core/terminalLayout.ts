/**
 * ターミナルを好きな数に並べる（tasks.md T-014）。
 *
 * 複数のエージェントを同時に走らせると、**出力を同時に見たくなる**。
 * VS Code は分割できるが、何枚まで並べるかは自分で決めることになり、
 * 4 枚に割ってから「細すぎて読めない」と気づく。
 *
 * ここで決めるのは **何枚までなら読めるか**。
 * 頼まれた枚数より減らしたときは、**減らしたと言う**（黙って減らさない）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface Pane {
	/** タブに出す名前 */
	name: string;
	/** そこで開く場所 */
	cwd?: string;
}

export interface PanePlan {
	panes: Pane[];
	/** 頼まれた枚数を減らしたか。減らしたなら、その理由 */
	note?: string;
}

/**
 * 1 枚あたり、これより狭いと読めない（桁数）。
 *
 * 80 桁は「本来の 1 行」だが、それを守ると 2 枚しか置けない。
 * ログを流し見るだけなら 40 桁で足りる — **折り返しても、どれが動いているかは分かる**。
 */
export const MIN_COLUMNS = 40;

/** 分割線が食う幅 */
const DIVIDER_COLUMNS = 1;

/**
 * その幅に、何枚まで置けるか。
 *
 * 幅が分からないときは 4 枚まで（画面の広さを勝手に決めない）。
 */
export function maxPanes(widthColumns?: number): number {
	if (widthColumns === undefined || widthColumns <= 0) {
		return 4;
	}
	const fits = Math.floor((widthColumns + DIVIDER_COLUMNS) / (MIN_COLUMNS + DIVIDER_COLUMNS));
	return Math.max(1, fits);
}

export interface PlanOptions {
	/** 何枚ほしいか */
	count: number;
	/** ターミナルの幅（桁）。分かるときだけ */
	widthColumns?: number;
	/** 開いているフォルダ。複数あれば 1 枚ずつ割り当てる */
	folders?: readonly { name: string; path: string }[];
	/** 読めなくなると分かっていても、頼んだ枚数のまま並べる */
	force?: boolean;
}

/**
 * 並べる計画を立てる。
 *
 * **フォルダが複数あるときは、フォルダごとに 1 枚**。
 * どの窓がどのプロジェクトか分からなくなるのが、複数フォルダでいちばん困ること。
 */
export function planPanes(options: PlanOptions): PanePlan {
	const requested = Math.max(1, Math.floor(options.count));
	const limit = maxPanes(options.widthColumns);
	const count = options.force ? requested : Math.min(requested, limit);
	const folders = options.folders ?? [];

	const panes: Pane[] = [];
	for (let i = 0; i < count; i++) {
		const folder = folders.length > 1 ? folders[i % folders.length] : folders[0];
		panes.push({
			name: folders.length > 1 ? `${folder.name} ${Math.floor(i / folders.length) + 1}` : `ターミナル ${i + 1}`,
			cwd: folder?.path
		});
	}

	const notes: string[] = [];
	if (count < requested) {
		notes.push(`${requested} 枚は幅が足りないので ${count} 枚にしました（1 枚 ${MIN_COLUMNS} 桁を下回ると読めなくなります）`);
	}
	// フォルダの数より枚数が少ないと、見えないフォルダができる
	if (folders.length > 1 && count < folders.length) {
		notes.push(`${folders.slice(count).map((folder) => folder.name).join('・')} は出ていません`);
	}
	return notes.length > 0 ? { panes, note: notes.join('。') } : { panes };
}

/** 何が起きるかを、押す前に見せる */
export function describePlan(plan: PanePlan): string {
	const names = plan.panes.map((pane) => pane.name).join(' / ');
	return plan.note ? `${plan.panes.length} 枚: ${names}（${plan.note}）` : `${plan.panes.length} 枚: ${names}`;
}
