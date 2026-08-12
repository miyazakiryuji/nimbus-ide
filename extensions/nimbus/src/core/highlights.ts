/**
 * 教材になるやり取りを切り出す（tasks.md T-214）。
 *
 * 実際のやり取りは、作った資料よりも教材になる。**うまくいった瞬間より、
 * 「なぜそうしたか」が残っている瞬間**のほうが役に立つ。
 *
 * ただし記録には、そのままでは出せないもの（ホームのパス＝OS のユーザー名、鍵らしき文字列）が
 * 混ざる。**切り出す時点で消す** — あとで消すつもりのものは、たいてい消し忘れる。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { TranscriptEntry } from './transcripts';

export interface Highlight {
	instruction: string;
	answer: string;
	at?: string;
	/** なぜ選ばれたか（人が選び直せるように） */
	reason: string;
}

/** 短すぎるやり取りは教材にならない */
const MIN_ANSWER = 200;

/** 長すぎると資料に貼れない */
const MAX_ANSWER = 4000;

/**
 * 出してはいけないものを消す。
 * **消す対象を増やしすぎない** — 消しすぎると何の話か分からなくなる。
 */
export function redact(text: string, home: string): string {
	let result = home.length > 0 ? text.split(home).join('~') : text;
	// 鍵らしき長い英数字（記録に混ざることがある）
	result = result.replace(/\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,})\b/g, '（鍵は伏せました）');
	return result;
}

/** 説明として使えるか。コードだけ・相槌だけのものを外す */
function looksInstructive(answer: string): boolean {
	if (answer.length < MIN_ANSWER) {
		return false;
	}
	const hasCode = /```/.test(answer);
	const hasReason = /(なぜ|ため|理由|なので|から)/.test(answer);
	return hasCode || hasReason;
}

function reasonFor(answer: string): string {
	const hasCode = /```/.test(answer);
	const hasReason = /(なぜ|ため|理由|なので|から)/.test(answer);
	if (hasCode && hasReason) {
		return 'コードと、その理由の両方がある';
	}
	return hasCode ? 'コードがある' : '理由が書かれている';
}

/**
 * 指示と、その直後の応答を組にして選ぶ。
 *
 * **言い直しの直前は選ばない**（うまく伝わらなかったやり取りなので、教材には向かない）。
 */
export function pickHighlights(entries: readonly TranscriptEntry[], home: string, limit = 5): Highlight[] {
	const ordered = [...entries].filter((entry) => entry.text.trim().length > 0);
	const highlights: Highlight[] = [];

	for (let i = 0; i < ordered.length - 1; i++) {
		const instruction = ordered[i];
		const answer = ordered[i + 1];
		if (instruction.role !== 'user' || answer.role !== 'assistant') {
			continue;
		}
		// 次の指示が言い直しなら、この組は選ばない
		const following = ordered[i + 2];
		if (following?.role === 'user' && /(違う|そうじゃ|やり直|じゃなくて)/.test(following.text)) {
			continue;
		}
		if (!looksInstructive(answer.text)) {
			continue;
		}
		highlights.push({
			instruction: redact(instruction.text.trim(), home),
			answer: redact(answer.text.trim().slice(0, MAX_ANSWER), home),
			at: instruction.timestamp,
			reason: reasonFor(answer.text)
		});
	}

	// 長い応答のほうが教材になりやすい（説明が尽くされている）
	return highlights.sort((a, b) => b.answer.length - a.answer.length).slice(0, limit);
}

export function renderHighlights(highlights: readonly Highlight[]): string {
	if (highlights.length === 0) {
		return [
			'# 切り出したやり取り',
			'',
			'教材に使えそうなやり取りが見つかりませんでした。',
			'（コードか理由が書かれている応答を探しています）',
			''
		].join('\n');
	}

	const lines = [
		'# 切り出したやり取り',
		'',
		`${highlights.length} 件。**ホームのパスと鍵らしき文字列は伏せてあります**が、`,
		'配る前にもう一度目で確かめてください。',
		''
	];

	for (const [index, highlight] of highlights.entries()) {
		lines.push(`## ${index + 1}. ${highlight.reason}`, '');
		if (highlight.at) {
			lines.push(`_${highlight.at.slice(0, 16).replace('T', ' ')}_`, '');
		}
		lines.push('**指示**', '', '> ' + highlight.instruction.split('\n').join('\n> '), '');
		lines.push('**応答**', '', highlight.answer, '', '---', '');
	}

	return lines.join('\n');
}
