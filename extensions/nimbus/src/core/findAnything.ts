/**
 * スキル以外も同じ場所から探す（tasks.md T-117）。
 *
 * スキルは F6 で探せるようになったが、サブエージェント・スラッシュコマンド・MCP ツールは
 * `contextView` に名前が並ぶだけで、**探せないし、そこから使えない**。
 * 覚えている人しか使えない機能は、無いのとあまり変わらない。
 *
 * 種類が違っても「名前と説明があり、選んだら何かが起きる」点は同じなので、
 * 1 つの入口にまとめる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type FindableKind = 'skill' | 'agent' | 'command' | 'tool' | 'prompt';

export interface Findable {
	kind: FindableKind;
	name: string;
	description: string;
	/** どこ由来か（プロジェクト / ユーザー / サーバー名など） */
	origin?: string;
	/** 選んだときに開くファイル。無ければ開けない */
	path?: string;
}

/** 種類の見出し。並び順もこの順にする（よく使うものから） */
export const KIND_LABEL: Record<FindableKind, string> = {
	skill: 'スキル',
	command: 'コマンド',
	agent: 'サブエージェント',
	tool: 'MCP ツール',
	prompt: 'プロンプト'
};

const KIND_ORDER: FindableKind[] = ['skill', 'command', 'agent', 'tool', 'prompt'];

/**
 * 曖昧な言葉で絞り込む。
 *
 * 名前だけでなく**説明にも当てる**のが肝（「PDF」で探したいのに名前が `docx-tools` の
 * ようなことが起きる）。当たった場所で点数を変え、名前に当たったものを上に出す。
 */
export function scoreFindable(item: Findable, query: string): number {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return 1;
	}
	const name = item.name.toLowerCase();
	const description = item.description.toLowerCase();
	if (name === needle) {
		return 100;
	}
	if (name.startsWith(needle)) {
		return 80;
	}
	if (name.includes(needle)) {
		return 60;
	}
	// 語ごとに説明へ当てる。全部含むときだけ拾う（1 語かすっただけで出さない）
	const words = needle.split(/\s+/).filter(Boolean);
	if (words.every((word) => description.includes(word) || name.includes(word))) {
		return 30;
	}
	return 0;
}

/** 絞り込んで並べる。点数が同じなら種類の順、それも同じなら名前順 */
export function searchFindables(items: readonly Findable[], query: string): Findable[] {
	return items
		.map((item) => ({ item, score: scoreFindable(item, query) }))
		.filter((entry) => entry.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) ||
				a.item.name.localeCompare(b.item.name)
		)
		.map((entry) => entry.item);
}

/**
 * 選んだものをコックピットへ送る文にする。
 * **MCP ツールとサブエージェントは「送って動くもの」ではない**ので、
 * 使いかたを頼む形にする（スラッシュコマンドのように直接は撃てない）。
 */
export function toPrompt(item: Findable): string {
	switch (item.kind) {
		case 'skill':
		case 'command':
			return `/${item.name}`;
		case 'agent':
			return `${item.name} のサブエージェントを使って、次のことをしてください: `;
		case 'tool':
			return `${item.name} を使って、次のことを調べてください: `;
		case 'prompt':
			return item.description;
	}
}

/** 一覧の右に出す説明 */
export function describeFindable(item: Findable): string {
	return [KIND_LABEL[item.kind], item.origin].filter(Boolean).join(' · ');
}
