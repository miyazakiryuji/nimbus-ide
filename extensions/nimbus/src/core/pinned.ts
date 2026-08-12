/**
 * コンテキストのピン留め（tasks.md T-152）。
 *
 * 「この規約は毎回読んでおいて」「この型定義は前提」— 毎回 `@` で指すのは面倒だし、
 * 指し忘れると前提を知らないまま書き始める。**常に含めるもの**を決められるようにする。
 *
 * SDK の `systemPrompt: { type:'preset', preset:'claude_code', append }` に足す形にするので、
 * Claude Code としての振る舞いは残したまま、前提だけを積める。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface PinnedFile {
	/** 表示と見出しに使うパス */
	path: string;
	content: string;
}

/**
 * ピン留め全体の上限。
 * 毎ターン積まれるので、ここが膨らむと**他のことを何も覚えられなくなる**。
 * 上限を超えたぶんは黙って切らず、外したことを呼び出し側へ返す。
 */
export const MAX_PINNED_BYTES = 60 * 1024;

export interface PinnedSelection {
	included: PinnedFile[];
	/** 上限に入らず外したもの（利用者に伝えるため） */
	dropped: string[];
	bytes: number;
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8');

/**
 * 上限に収まるぶんだけ選ぶ。**先に指定したものを優先**する
 * （並び順が利用者の優先順位そのものなので、勝手に並べ替えない）。
 */
export function selectWithinBudget(files: readonly PinnedFile[], maxBytes: number = MAX_PINNED_BYTES): PinnedSelection {
	const included: PinnedFile[] = [];
	const dropped: string[] = [];
	let bytes = 0;
	for (const file of files) {
		const size = byteLength(file.content);
		if (bytes + size > maxBytes) {
			dropped.push(file.path);
			continue;
		}
		included.push(file);
		bytes += size;
	}
	return { included, dropped, bytes };
}

/**
 * システムプロンプトへ足す文章を組み立てる。
 * **これが前提であること**と、**古くなっている可能性**を明示する
 * （ピン留めは貼った時点の写しなので、途中で変わっても追従しない）。
 */
export function buildPinnedPrompt(files: readonly PinnedFile[]): string {
	if (files.length === 0) {
		return '';
	}
	const blocks = files.map((file) => `### ${file.path}\n\n\`\`\`\n${file.content.trimEnd()}\n\`\`\``);
	return [
		'## 常に踏まえる前提（Nimbus のピン留め）',
		'',
		'利用者が「毎回読んでおいてほしい」と指定したファイルです。作業の前提として扱ってください。',
		'これはセッション開始時点の写しです。作業中に変わった可能性があるときは読み直してください。',
		'',
		...blocks
	].join('\n');
}

/** 一覧表示用の 1 行 */
export function describePinned(selection: PinnedSelection): string {
	if (selection.included.length === 0) {
		return 'ピン留めなし';
	}
	const size = `${Math.round(selection.bytes / 1024)}KB`;
	const dropped = selection.dropped.length > 0 ? ` · ${selection.dropped.length} 件は上限超過で除外` : '';
	return `${selection.included.length} 件（${size}）${dropped}`;
}
