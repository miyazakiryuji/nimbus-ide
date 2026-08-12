/**
 * `tasks.md` とタスク板の対応づけ（tasks.md T-013）。
 *
 * 「やること」は `tasks.md` にあり、「走っているもの」は板にある。**同じものが 2 か所にある**と、
 * どちらが正か分からなくなる。板から着手でき、終わったら `tasks.md` の 完了 へ戻るようにする。
 *
 * `tasks.md` 自身の書式（README「書きかた」）に従う:
 * - 1 タスク 1 行、`- [ ] T-001 …` で始まる
 * - 続きの行は字下げ（本文の折り返し）
 * - 状態は置き場所で表す（`## 進行中` / `## 完了` など）
 * - 優先度は行末の `[P1]` / `[P2]` / `[P3]`
 *
 * 文字列を扱うだけなので単体で検証できる。
 */

export interface TasksFileEntry {
	/** `T-001` の形 */
	id: string;
	/** 見出し（1 行目の本文。ID と優先度を除いたもの） */
	title: string;
	/** 折り返しを含む行全体 */
	raw: string;
	done: boolean;
	/** 属している `##` セクション名（`Inbox（未整理）` など） */
	section: string;
	priority?: 'P1' | 'P2' | 'P3';
	/** 誰かが claim 済みか（`@session-a` のような印がある） */
	claimed: boolean;
	/** 0 始まりの行番号（1 行目） */
	line: number;
}

const ENTRY = /^- \[( |x)\] (T-\d{3})\s+(.*)$/;
const SECTION = /^##\s+(.+?)\s*$/;
const PRIORITY = /\[(P[123])\]\s*$/;
const CLAIM = /@[\w-]+\s+\d{4}-\d{2}-\d{2}/;

/** 見出しから ID・優先度・装飾を落として、読める題名にする */
function toTitle(rest: string): string {
	return rest
		.replace(PRIORITY, '')
		.replace(/\*\*/g, '')
		.replace(/\s*—\s*$/, '')
		.trim();
}

/**
 * `tasks.md` を読んで項目を並べる。
 * **定義行（`- [ ] T-xxx`）だけ**を項目として扱い、参照（本文中の `T-xxx`）は拾わない。
 */
export function parseTasksFile(content: string): TasksFileEntry[] {
	const lines = content.split('\n');
	const entries: TasksFileEntry[] = [];
	let section = '';
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const heading = SECTION.exec(line);
		if (heading) {
			section = heading[1];
			continue;
		}
		const match = ENTRY.exec(line);
		if (!match) {
			continue;
		}
		// 折り返し（字下げされた続き）を集める
		const continuation: string[] = [];
		for (let next = index + 1; next < lines.length; next++) {
			if (!/^\s+\S/.test(lines[next])) {
				break;
			}
			continuation.push(lines[next]);
		}
		const raw = [line, ...continuation].join('\n');
		const priority = PRIORITY.exec(raw)?.[1] as TasksFileEntry['priority'] | undefined;
		entries.push({
			id: match[2],
			title: toTitle(match[3]),
			raw,
			done: match[1] === 'x',
			section,
			priority,
			claimed: CLAIM.test(raw),
			line: index
		});
	}
	return entries;
}

/** 板へ持っていける候補。完了済み・claim 済みは出さない（二重作業の元になる） */
export function startableEntries(entries: readonly TasksFileEntry[]): TasksFileEntry[] {
	const order = { P1: 0, P2: 1, P3: 2, undefined: 3 } as Record<string, number>;
	return entries
		.filter((entry) => !entry.done && !entry.claimed)
		.sort((a, b) => (order[String(a.priority)] ?? 3) - (order[String(b.priority)] ?? 3));
}

/**
 * 項目を 完了 セクションへ移す（T-013 の「完了すると tasks.md の 完了 へ」）。
 *
 * **行ごと動かす**のが `tasks.md` の約束（README「書きかた」）。書き換えると、
 * 並行して編集している他のセッションと機械的にマージできなくなる。
 * 見つからない・すでに完了しているときは、何もせず `undefined` を返す（黙って壊さない）。
 */
export function moveToDone(content: string, id: string, note: string): string | undefined {
	const entries = parseTasksFile(content);
	const entry = entries.find((candidate) => candidate.id === id);
	if (!entry || entry.done) {
		return undefined;
	}
	const doneHeading = '## 完了';
	if (!content.includes(doneHeading)) {
		return undefined;
	}
	// 元の行を取り除く（前後の改行を残さない）
	const withoutEntry = content.replace(`${entry.raw}\n`, '');
	const moved = `- [x] ${entry.id} ${entry.title}${note ? ` — ${note}` : ''}\n`;
	// 完了セクションの見出し直後（説明文の次の空行のあと）へ差し込む
	const headingAt = withoutEntry.indexOf(doneHeading);
	const firstEntryAt = withoutEntry.indexOf('\n- [x] ', headingAt);
	if (firstEntryAt < 0) {
		// まだ 1 件も無いときは、見出しの次の行へ
		const lineEnd = withoutEntry.indexOf('\n', headingAt);
		return `${withoutEntry.slice(0, lineEnd + 1)}\n${moved}${withoutEntry.slice(lineEnd + 1)}`;
	}
	return `${withoutEntry.slice(0, firstEntryAt + 1)}${moved}${withoutEntry.slice(firstEntryAt + 1)}`;
}
