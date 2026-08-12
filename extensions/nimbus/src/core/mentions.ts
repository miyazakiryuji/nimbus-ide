/**
 * 指示の中で名指しされたシンボルを拾う（tasks.md T-175）。
 *
 * 「`SessionManager.createSession` を直して」と書いたとき、エージェントはまず
 * その関数を探すところから始める。**実物のシグネチャを先に渡してしまえば**、
 * 探す往復も、思い込みで存在しない引数を書く事故も減る（T-101 の前段）。
 *
 * VS Code に依存しない。文からそれらしい名前を拾うところまでを置く。
 */

/** 一度に添付する数の上限。多すぎると指示より添付の方が長くなる */
export const DEFAULT_MENTION_LIMIT = 5;

/** コードの名前として短すぎるもの・普通の単語と紛れるものは拾わない */
const MIN_LENGTH = 3;

/**
 * 拾わない語。
 * 見出しや文章に出てくる大文字語まで引くと、関係ないシンボルの定義が並ぶ。
 */
const STOPWORDS = new Set([
	'The', 'This', 'That', 'There', 'These', 'Those', 'When', 'What', 'With',
	'Nimbus', 'Claude', 'VSCode', 'TODO', 'README', 'CLAUDE'
]);

/** バッククォートで囲まれた名前。人が「これ」と指したものなので、いちばん強い手がかり */
const BACKTICKED = /`([A-Za-z_][\w.]*)\s*(?:\(\))?`/g;
/** `Class.method` の形 */
const DOTTED = /\b([A-Z][A-Za-z0-9_]*\.[A-Za-z_]\w*)\b/g;
/** 呼び出しの形（`foo(` ） */
const CALL = /\b([A-Za-z_]\w*)\s*\(/g;
/** PascalCase。山が 2 つ以上あるものだけ（`The` のような普通の語を避ける） */
const PASCAL = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)\b/g;

function collect(pattern: RegExp, text: string, into: string[]): void {
	pattern.lastIndex = 0;
	for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
		const name = match[1];
		if (name.length >= MIN_LENGTH && !STOPWORDS.has(name)) {
			into.push(name);
		}
	}
}

/**
 * 指示の中の「シンボルらしい名前」を、確からしい順に返す。
 * バッククォート → `Class.method` → 呼び出しの形 → PascalCase の順で強い。
 */
export function extractSymbolMentions(text: string, limit: number = DEFAULT_MENTION_LIMIT): string[] {
	const found: string[] = [];
	collect(BACKTICKED, text, found);
	collect(DOTTED, text, found);
	collect(CALL, text, found);
	collect(PASCAL, text, found);

	const seen = new Set<string>();
	const unique: string[] = [];
	for (const name of found) {
		const key = name.toLowerCase();
		if (seen.has(key)) {
			continue;
		}
		// `SessionManager.close` を拾ったあとの `SessionManager` は、同じ話の重複でしかない
		if (unique.some((taken) => taken.toLowerCase().startsWith(`${key}.`))) {
			continue;
		}
		seen.add(key);
		unique.push(name);
		if (unique.length >= Math.max(1, limit)) {
			break;
		}
	}
	return unique;
}

export interface SignatureNote {
	/** 指示に書かれていた名前 */
	mention: string;
	/** 見つかった場所（表示用の相対パス＋行） */
	where: string;
	/** シグネチャ（hover の 1 行目あたり） */
	signature: string;
}

/**
 * 添付する文。**Nimbus が足したものだと分かるように見出しを付ける**。
 * 黙って指示を書き換えたように見えると、何が文脈に入ったのかを説明できなくなる。
 */
export function renderSignatureNote(notes: readonly SignatureNote[]): string {
	if (notes.length === 0) {
		return '';
	}
	const lines = notes.map((note) => `- ${note.mention} — ${note.where}\n  ${note.signature}`);
	return ['（Nimbus が添付した実際のシグネチャ。推測せずこちらを使ってください）', ...lines].join('\n');
}

/** hover の本文からシグネチャらしい行だけを取り出す */
export function signatureFromHover(hover: string, maxChars = 300): string {
	const lines = hover
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith('```') && line !== '---');
	const first = lines[0] ?? '';
	return first.length > maxChars ? `${first.slice(0, maxChars)}…` : first;
}
