/**
 * レビューコメントを、直す作業に変える（tasks.md T-116）。
 *
 * コメントは散らばって届く。**どれが直しの依頼で、どれが感想か**を仕分けるだけで、
 * 手が動き出す。さらに「どのファイルの何行目か」が付いていれば、そのまま作業になる。
 *
 * **感想を依頼として扱わない。** 全部を直しの対象にすると、いちいち確認が要って結局止まる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface ReviewComment {
	author: string;
	body: string;
	path?: string;
	line?: number;
	url?: string;
}

export type CommentKind = 'change-request' | 'question' | 'praise' | 'note';

export interface ClassifiedComment extends ReviewComment {
	kind: CommentKind;
}

const CHANGE = /(直して|修正して|変えて|してください|すべき|してほしい|必要です|漏れ|抜けて|バグ|壊れ|べきでは)/;
const QUESTION = /[?？]\s*$|(のでしょうか|ですか|でしょうか|なぜ|どうして)/;
const PRAISE = /(いいですね|良いですね|助かり|ありがとう|素晴らし|きれい|読みやすい|LGTM)/i;

/**
 * 仕分ける。
 *
 * **依頼 → 質問 → 感想**の順で見る。「いいですね。ただ、ここは直してください」は依頼。
 * 褒め言葉が含まれていても、直しの依頼なら依頼として扱う。
 */
export function classifyComment(body: string): CommentKind {
	if (CHANGE.test(body)) {
		return 'change-request';
	}
	if (QUESTION.test(body)) {
		return 'question';
	}
	if (PRAISE.test(body)) {
		return 'praise';
	}
	return 'note';
}

export function classifyAll(comments: readonly ReviewComment[]): ClassifiedComment[] {
	return comments.map((comment) => ({ ...comment, kind: classifyComment(comment.body) }));
}

/** 直す作業に変える。場所が分かるものを先に並べる（そのまま手が動くので） */
export function toWorkList(comments: readonly ClassifiedComment[]): ClassifiedComment[] {
	return comments
		.filter((comment) => comment.kind === 'change-request' || comment.kind === 'question')
		.sort((a, b) => {
			const placed = Number(Boolean(b.path)) - Number(Boolean(a.path));
			if (placed !== 0) {
				return placed;
			}
			const kind = Number(a.kind === 'question') - Number(b.kind === 'question');
			return kind !== 0 ? kind : (a.path ?? '').localeCompare(b.path ?? '');
		});
}

/** Claude に渡す文。**1 件ずつ渡す**（まとめて渡すと、どれに対する修正か分からなくなる） */
export function toPrompt(comment: ClassifiedComment): string {
	const place = comment.path ? `${comment.path}${comment.line ? `:${comment.line}` : ''}` : '（場所の指定なし）';
	return [
		`レビューで次の指摘を受けました。${place} を直してください。`,
		'',
		`> ${comment.body.split('\n').join('\n> ')}`,
		'',
		'直す前に、指摘の意図が読み取れないときは、そのまま直さずに聞いてください。'
	].join('\n');
}

const KIND_LABEL: Record<CommentKind, string> = {
	'change-request': '直しの依頼',
	question: '質問',
	praise: '感想',
	note: 'その他'
};

export function renderComments(comments: readonly ClassifiedComment[]): string {
	if (comments.length === 0) {
		return '# レビューコメント\n\nコメントが見つかりませんでした。\n';
	}

	const work = toWorkList(comments);
	const lines = [
		'# レビューコメント',
		'',
		`${comments.length} 件のうち、**手を動かすもの: ${work.length} 件**`,
		''
	];

	for (const kind of ['change-request', 'question', 'praise', 'note'] as CommentKind[]) {
		const rows = comments.filter((comment) => comment.kind === kind);
		if (rows.length === 0) {
			continue;
		}
		lines.push(`## ${KIND_LABEL[kind]}（${rows.length}）`, '');
		for (const row of rows) {
			const place = row.path ? ` — \`${row.path}${row.line ? `:${row.line}` : ''}\`` : '';
			lines.push(`- **${row.author}**${place}`, `  > ${row.body.split('\n').join('\n  > ')}`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
