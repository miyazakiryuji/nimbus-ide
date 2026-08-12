/**
 * 積み上げた PR を管理する（tasks.md T-135）。
 *
 * 1 つの大きな PR を分けて積むと、レビューは通しやすくなる代わりに**運用が難しくなる**。
 * 積んだ順を間違えると入らないし、下が入った瞬間に上の PR の差分が**別物に見える**
 * （まだ入っていない下の変更まで自分の差分に混ざる）。
 *
 * ここでやるのは 3 つ:
 *
 * 1. **積み方を見る** — どの PR がどの PR の上に乗っているか
 * 2. **入れる順を出す** — 下から。ここを取り違えると入らない
 * 3. **下が入った後の付け替えを出す** — いちばん忘れる作業
 *
 * **こちらからは操作しない。** 出すのはコマンドの中身まで。走らせるのは人
 * （PR の base を書き換えるのは、他人のレビューが載っている場所への変更）。
 *
 * VS Code に依存しない。
 */

export interface PullRequest {
	number: number;
	title: string;
	/** この PR のブランチ */
	head: string;
	/** この PR が向いている先 */
	base: string;
	isDraft: boolean;
}

export interface StackNode {
	pr: PullRequest;
	/** この PR の上に積まれている PR */
	above: StackNode[];
}

/** `gh pr list --json number,title,headRefName,baseRefName,isDraft` の出力を読む */
export function parsePrList(json: string): PullRequest[] {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return [];
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	const prs: PullRequest[] = [];
	for (const entry of raw) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		if (typeof record.number !== 'number' || typeof record.headRefName !== 'string') {
			continue;
		}
		prs.push({
			number: record.number,
			title: typeof record.title === 'string' ? record.title : '',
			head: record.headRefName,
			base: typeof record.baseRefName === 'string' ? record.baseRefName : '',
			isDraft: record.isDraft === true
		});
	}
	return prs;
}

/**
 * 積み方を組む。
 *
 * 幹（`trunk`）を向いている PR が根。その PR のブランチを向いている PR が、その上。
 * **輪になっていたら組み込まない** — 壊れた状態を「積んである」と見せない。
 */
export function buildStacks(prs: readonly PullRequest[], trunk: string): StackNode[] {
	const byBase = new Map<string, PullRequest[]>();
	for (const pr of prs) {
		byBase.set(pr.base, [...(byBase.get(pr.base) ?? []), pr]);
	}
	const visited = new Set<number>();
	const build = (base: string): StackNode[] =>
		(byBase.get(base) ?? [])
			.filter((pr) => !visited.has(pr.number))
			.map((pr) => {
				visited.add(pr.number);
				return { pr, above: build(pr.head) };
			})
			.sort((a, b) => a.pr.number - b.pr.number);
	return build(trunk);
}

/** どこにも繋がらなかった PR。幹の名前が違うか、下の PR が閉じている */
export function orphans(prs: readonly PullRequest[], stacks: readonly StackNode[]): PullRequest[] {
	const placed = new Set<number>();
	const walk = (nodes: readonly StackNode[]): void => {
		for (const node of nodes) {
			placed.add(node.pr.number);
			walk(node.above);
		}
	};
	walk(stacks);
	return prs.filter((pr) => !placed.has(pr.number));
}

/** 入れる順。**下から**。ここを取り違えると入らない */
export function mergeOrder(stacks: readonly StackNode[]): PullRequest[] {
	const order: PullRequest[] = [];
	const walk = (nodes: readonly StackNode[]): void => {
		for (const node of nodes) {
			order.push(node.pr);
			walk(node.above);
		}
	};
	walk(stacks);
	return order;
}

/** その PR より下にあるもの（先に入っていないといけない PR） */
export function below(stacks: readonly StackNode[], number: number): PullRequest[] {
	const path: PullRequest[] = [];
	const walk = (nodes: readonly StackNode[], trail: PullRequest[]): boolean => {
		for (const node of nodes) {
			if (node.pr.number === number) {
				path.push(...trail);
				return true;
			}
			if (walk(node.above, [...trail, node.pr])) {
				return true;
			}
		}
		return false;
	};
	walk(stacks, []);
	return path;
}

export interface Restack {
	number: number;
	head: string;
	/** いま向いている先 */
	from: string;
	/** 向け直す先 */
	to: string;
}

/**
 * 下の PR が入った後の付け替え。
 *
 * **いちばん忘れる作業。** 直上の PR の base を、入った PR の base（＝幹）へ向け直さないと、
 * 入ったはずの変更が上の PR の差分に残り続ける。
 */
export function afterMerge(prs: readonly PullRequest[], mergedHead: string, mergedBase: string): Restack[] {
	return prs
		.filter((pr) => pr.base === mergedHead)
		.map((pr) => ({ number: pr.number, head: pr.head, from: pr.base, to: mergedBase }));
}

/**
 * 付け替えのコマンド。
 *
 * `--onto` を使って**入った分だけ**を落とす。素の `git rebase` だと、
 * 既に入っているコミットが重複して当たる。
 */
export function renderRestackCommands(restacks: readonly Restack[]): string {
	if (restacks.length === 0) {
		return '';
	}
	const lines = ['# 下が入ったので、上の PR を向け直します（中身を読んでから実行してください）', 'git fetch origin'];
	for (const restack of restacks) {
		lines.push(
			'',
			`# #${restack.number} ${restack.head}: ${restack.from} → ${restack.to}`,
			`git switch ${restack.head}`,
			`git rebase --onto origin/${restack.to} origin/${restack.from}`,
			`git push --force-with-lease origin ${restack.head}`,
			`gh pr edit ${restack.number} --base ${restack.to}`
		);
	}
	return `${lines.join('\n')}\n`;
}

/** 積み方を木で見せる */
export function describeStacks(stacks: readonly StackNode[], trunk: string): string {
	if (stacks.length === 0) {
		return '積み上げた PR はありません。';
	}
	const lines = [trunk];
	const walk = (nodes: readonly StackNode[], depth: number): void => {
		nodes.forEach((node, index) => {
			const last = index === nodes.length - 1;
			const indent = '  '.repeat(depth);
			const draft = node.pr.isDraft ? '（下書き）' : '';
			lines.push(`${indent}${last ? '└─' : '├─'} #${node.pr.number} ${node.pr.title}${draft}`);
			walk(node.above, depth + 1);
		});
	};
	walk(stacks, 0);
	const order = mergeOrder(stacks);
	lines.push('', `入れる順: ${order.map((pr) => `#${pr.number}`).join(' → ')}`);
	return lines.join('\n');
}
