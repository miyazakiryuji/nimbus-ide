/**
 * 圧縮前に「何を残すか」を選ぶ（tasks.md T-154）。
 *
 * コンパクションは黙って起きて、黙って要約する。何が落ちたかは後から分からない。
 * せめて**落としてほしくないもの**を先に言えるようにする。
 *
 * Claude Code の `/compact` は後ろに指示を取れるので、選んだものを
 * 「これは残して」という形で渡す。SDK に選別用の API があるわけではないので、
 * **できるのは要約への指示までで、保証ではない** — 仕様にもそう書く。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';

export interface CompactCandidate {
	/** 一覧に出す文 */
	label: string;
	/** 指示に載せる本文 */
	text: string;
	at: number;
	kind: 'instruction' | 'decision';
}

const LABEL_LIMIT = 70;
/** 候補として出す上限。多すぎると選べない */
const CANDIDATE_LIMIT = 40;
/** 短すぎる発言は選ぶ意味がない（「はい」「続けて」など） */
const MIN_TEXT_LENGTH = 8;

function toLabel(text: string): string {
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT)}…` : flat;
}

/**
 * 残す候補を集める。
 *
 * **利用者の指示**（何を頼んだか）と、**決まったこと**（Claude が最後に返したまとめ）を出す。
 * ツールの出入りは要約されて困るものではないので入れない。
 */
export function compactCandidates(events: readonly NimbusEvent[]): CompactCandidate[] {
	const candidates: CompactCandidate[] = [];
	for (const event of events) {
		if (event.kind === 'user-text' && event.text.trim().length >= MIN_TEXT_LENGTH) {
			candidates.push({ label: toLabel(event.text), text: event.text, at: event.timestamp, kind: 'instruction' });
		} else if (event.kind === 'turn-result' && event.resultText && event.resultText.trim().length >= MIN_TEXT_LENGTH) {
			candidates.push({
				label: toLabel(event.resultText),
				text: event.resultText,
				at: event.timestamp,
				kind: 'decision'
			});
		}
	}
	// 新しいものほど残したいことが多い。上限を超えたら古いほうから落とす
	return candidates.slice(-CANDIDATE_LIMIT).reverse();
}

/**
 * `/compact` に渡す文を組み立てる。
 * 選んでいなければ素の `/compact`（＝これまでどおり全部おまかせ）。
 */
export function buildCompactCommand(selected: readonly CompactCandidate[]): string {
	if (selected.length === 0) {
		return '/compact';
	}
	// 古い順に並べ直す。要約の中で時系列が逆になると読みにくい
	const ordered = [...selected].sort((a, b) => a.at - b.at);
	const lines = ordered.map((candidate) => `- ${candidate.text.replace(/\s+/g, ' ').trim()}`);
	return [
		'/compact 次の点は要約後も必ず残してください。省略・言い換えをしないでください。',
		...lines
	].join('\n');
}
