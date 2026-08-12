/**
 * 何をしたのかを、順を追って見せる（tasks.md T-045 解説モード）。
 *
 * エージェントの作業は速いので、**見ていても何が起きたか分からない**。
 * あとから「どのファイルを、どの順で、なぜ触ったか」を並べ直すと、追える形になる。
 * 画面共有しながらこれを開けば、そのまま説明に使える。
 *
 * **理由は、本人が書いた文からしか取らない。** 推測して補うと、それらしいが嘘の解説になる。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { TranscriptEntry } from './transcripts';

export interface ExplainStep {
	kind: 'instruction' | 'reason' | 'touch';
	text: string;
	/** そのとき触ったファイル */
	files?: string[];
	tools?: string[];
}

/** 理由らしい 1 文を取り出す。**無ければ何も返さない**（作らない） */
export function reasonSentence(text: string): string | undefined {
	const sentences = text
		.split(/(?<=[。！？\n])/)
		.map((sentence) => sentence.trim())
		.filter((sentence) => sentence.length >= 10 && sentence.length <= 140);
	return sentences.find((sentence) => /(なぜなら|ため|理由|なので|から先に|先に|まず)/.test(sentence));
}

/** パスを短くする（末尾 2 つ） */
export function shortPath(path: string): string {
	const parts = path.split('/');
	return parts.length > 2 ? parts.slice(-2).join('/') : path;
}

/**
 * 記録を、追える順番に並べ直す。
 *
 * 同じファイルを続けて触ったものは 1 つにまとめる（同じ行が並ぶと読めない）。
 */
export function buildExplanation(entries: readonly TranscriptEntry[]): ExplainStep[] {
	const steps: ExplainStep[] = [];

	for (const entry of entries) {
		if (entry.role === 'user') {
			if (entry.text.trim().length > 0) {
				steps.push({ kind: 'instruction', text: entry.text.trim() });
			}
			continue;
		}

		const reason = reasonSentence(entry.text);
		if (reason) {
			steps.push({ kind: 'reason', text: reason });
		}

		if (entry.tools.length === 0 && entry.files.length === 0) {
			continue;
		}
		const previous = steps[steps.length - 1];
		const files = [...new Set(entry.files.map(shortPath))];
		if (previous?.kind === 'touch' && previous.files?.join() === files.join()) {
			previous.tools = [...new Set([...(previous.tools ?? []), ...entry.tools])];
			continue;
		}
		steps.push({
			kind: 'touch',
			text: files.length > 0 ? files.join(' / ') : entry.tools.join(' / '),
			files,
			tools: [...new Set(entry.tools)]
		});
	}

	return steps;
}

export function renderExplanation(steps: readonly ExplainStep[]): string {
	if (steps.length === 0) {
		return '# 何をしたか\n\n並べ直せる記録がありませんでした。\n';
	}

	const lines = [
		'# 何をしたか',
		'',
		'記録を順に並べ直したものです。**理由は、書かれていたものだけを載せています**',
		'（書かれていなければ空欄です。推測では補いません）。',
		''
	];

	let index = 0;
	for (const step of steps) {
		if (step.kind === 'instruction') {
			index++;
			lines.push(`## ${index}. 指示`, '', '> ' + step.text.split('\n').join('\n> '), '');
		} else if (step.kind === 'reason') {
			lines.push(`- **なぜ**: ${step.text}`);
		} else {
			const tools = step.tools?.length ? `（${step.tools.join(' / ')}）` : '';
			lines.push(`- 触った: \`${step.text}\`${tools}`);
		}
	}
	lines.push('');
	return lines.join('\n');
}
