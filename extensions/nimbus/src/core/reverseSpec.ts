/**
 * 仕様の逆生成（tasks.md T-080）。
 *
 * ドキュメントが無いコードは、読むたびに読み直すことになる。
 * かといって「仕様書を書いて」と丸投げすると、**それらしい嘘**が出てくる —
 * コードから読み取れないこと（なぜそうしたか）まで、もっともらしく書かれてしまう。
 *
 * だから頼み方を固定する。**事実と推測を分けて書かせる。**
 *
 * VS Code に依存しない。
 */
import { specTemplate } from './decisions';

/** 仕様書の置き場所。既存の `nimbus/docs/specs/*.md` に合わせる */
export function specPathFor(file: string): string {
	const base = (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '');
	const kebab = base
		.replace(/([a-z0-9])([A-Z])/g, '$1-$2')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
	return `nimbus/docs/specs/${kebab || 'spec'}.md`;
}

export interface ReverseSpecInput {
	/** 対象（表示用の相対パス） */
	file: string;
	/** アウトライン（`Class Foo (12–40)` のような行） */
	outline: string;
	specPath: string;
	/** その仕様書が既にあるか */
	exists: boolean;
}

/**
 * 頼み方。
 * **「読み取れる事実」と「推測」を分けさせる**のが要点。理由が記録されていないものは、
 * 「記録されていない」と書かせる — 埋めたふりをさせない。
 */
export function buildReverseSpecPrompt(input: ReverseSpecInput): string {
	const parts = [
		input.exists
			? `${input.file} の仕様書 ${input.specPath} を、いまのコードに合わせて直してください。`
			: `${input.file} から仕様書を起こして ${input.specPath} に書いてください。`,
		'',
		'守ってほしいこと:',
		'- **コードから読み取れる事実だけ**を書く',
		'- 読み取れないこと（なぜこの設計にしたか）は、**「理由は記録されていない」**と書く',
		'- どうしても書きたい推測は、**「推測:」と明記**する',
		'- 振る舞いは「何ができるか」で書く。実装の手順をなぞらない'
	];
	if (input.exists) {
		parts.push('- **既にある記述を消さない。** 食い違っている箇所だけを直し、直した理由を残す');
	}
	if (input.outline.trim().length > 0) {
		parts.push('', '構造（言語サーバーのアウトライン）:', '````', input.outline, '````');
	}
	parts.push('', '型:', '````markdown', specTemplate(`（機能名）`), '````');
	return parts.join('\n');
}
