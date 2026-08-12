/**
 * セッションを人に見せられる形にする（tasks.md T-048）。
 *
 * 「ここで詰まっている」を伝えるのに、いちばん早いのは**やり取りをそのまま見せること**。
 * ただし記録には出せないものが混ざるので、**出す前に何が消えるかを見せて、人に確かめさせる**。
 *
 * Nimbus はどこにもアップロードしない。**作るのは 1 枚のファイルまで**
 * （公開するかどうかは人が決めることで、機械が決めてよいことではない）。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { TranscriptEntry } from './transcripts';
import { redact } from './highlights';

export interface ShareOptions {
	home: string;
	/** 差分を添えるなら、その中身 */
	diff?: string;
	/** 何に困っているか（人が書く） */
	question?: string;
	/** 直近いくつのやり取りを載せるか */
	turns: number;
}

export interface RedactionReport {
	/** 伏せた箇所の数 */
	count: number;
	/** 何を伏せたか（種類だけ。中身は出さない） */
	kinds: string[];
}

/** 何が伏せられるかを、出す前に数える */
export function inspectRedactions(text: string, home: string): RedactionReport {
	const kinds: string[] = [];
	let count = 0;

	if (home.length > 0) {
		const hits = text.split(home).length - 1;
		if (hits > 0) {
			kinds.push('ホームのパス（OS のユーザー名）');
			count += hits;
		}
	}
	const keys = text.match(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g);
	if (keys) {
		kinds.push('鍵らしき文字列');
		count += keys.length;
	}
	return { count, kinds };
}

/**
 * 共有用の 1 枚を作る。
 *
 * **最後のやり取りから遡って載せる**（困っているのはたいてい最後なので）。
 */
export function buildShareDocument(entries: readonly TranscriptEntry[], options: ShareOptions): string {
	const conversation = entries
		.filter((entry) => entry.text.trim().length > 0)
		.slice(-options.turns);

	const lines = ['# 見てほしいやり取り', ''];

	if (options.question?.trim()) {
		lines.push('## 困っていること', '', options.question.trim(), '');
	} else {
		lines.push('## 困っていること', '', '<!-- 何を見てほしいかを書いてください -->', '');
	}

	lines.push('## やり取り', '');
	for (const entry of conversation) {
		lines.push(entry.role === 'user' ? '**指示**' : '**Claude**', '');
		lines.push(redact(entry.text.trim(), options.home), '');
		if (entry.files.length > 0) {
			lines.push(`_触ったファイル: ${entry.files.map((file) => redact(file, options.home)).join(' / ')}_`, '');
		}
	}

	if (options.diff?.trim()) {
		lines.push('## そのときの差分', '', '```diff', redact(options.diff.trim(), options.home), '```', '');
	}

	lines.push(
		'---',
		'',
		'_ホームのパスと鍵らしき文字列は伏せてあります。**渡す前にもう一度目で確かめてください。**_',
		''
	);

	return lines.join('\n');
}
