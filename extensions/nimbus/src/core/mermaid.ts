/**
 * Mermaid の図を、描く前に確かめる（tasks.md T-061）。
 *
 * エージェントが描いた図は、**構文が通らないと何も出ない**。しかもエラーは
 * 「Parse error on line 3」のような形で、どこが悪いかは分かっても**何が悪いか**は分からない。
 *
 * ここでは描画そのものはしない（レンダラを同梱すると重い）。代わりに
 * **よくある間違いを、直しかたつきで先に出す**。図そのものは VS Code の
 * Markdown プレビューに任せる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface MermaidBlock {
	/** ```mermaid の次の行（0 始まり） */
	line: number;
	content: string;
}

export interface MermaidProblem {
	line: number;
	message: string;
	fix: string;
}

/** Mermaid の図の種類。先頭行で決まる */
const KINDS = [
	'graph',
	'flowchart',
	'sequenceDiagram',
	'classDiagram',
	'stateDiagram',
	'stateDiagram-v2',
	'erDiagram',
	'journey',
	'gantt',
	'pie',
	'mindmap',
	'timeline',
	'gitGraph'
];

/** Markdown から ```mermaid の塊を取り出す */
export function extractMermaidBlocks(markdown: string): MermaidBlock[] {
	const lines = markdown.split('\n');
	const blocks: MermaidBlock[] = [];
	let start = -1;

	for (let i = 0; i < lines.length; i++) {
		const fence = /^\s*```\s*(\w*)/.exec(lines[i]);
		if (!fence) {
			continue;
		}
		if (start < 0 && fence[1] === 'mermaid') {
			start = i;
		} else if (start >= 0 && fence[1] === '') {
			blocks.push({ line: start + 1, content: lines.slice(start + 1, i).join('\n') });
			start = -1;
		}
	}
	return blocks;
}

/**
 * よくある間違いを見る。
 *
 * **構文解析はしない。** Mermaid の文法は種類ごとに違い、追いかけると保守できない。
 * ここで見るのは「これをやると必ず落ちる」と分かっているものだけ。
 */
export function checkMermaid(block: MermaidBlock): MermaidProblem[] {
	const problems: MermaidProblem[] = [];
	const lines = block.content.split('\n');
	const first = lines.find((line) => line.trim().length > 0)?.trim() ?? '';

	if (first.length === 0) {
		return [{ line: block.line, message: '中身がありません', fix: '`graph TD` などの種類から書き始めます' }];
	}

	if (!KINDS.some((kind) => first.startsWith(kind))) {
		problems.push({
			line: block.line,
			message: `先頭が図の種類になっていません（\`${first.slice(0, 20)}\`）`,
			fix: `\`graph TD\` / \`sequenceDiagram\` などから始めます（使えるのは ${KINDS.slice(0, 5).join(' / ')} ほか）`
		});
	}

	for (const [offset, line] of lines.entries()) {
		const at = block.line + offset;

		// ラベルの中の括弧は、引用符で囲まないと落ちる（いちばんよく踏む）
		if (/\[[^\]"]*[()][^\]]*\]/.test(line)) {
			problems.push({
				line: at,
				message: 'ラベルの中に括弧があります（そのままだと落ちます）',
				fix: '`A["文字 (注)"]` のように、ラベル全体を `"` で囲みます'
			});
		}

		// 全角の矢印や記号は通らない
		if (/[→⇒－ー―]/.test(line)) {
			problems.push({
				line: at,
				message: '全角の記号が混ざっています',
				fix: '矢印は `-->`、線は半角の `-` で書きます'
			});
		}

		// `end` の大文字始まりは、サブグラフの終端として認識されない
		if (/^\s*End\s*$/.test(line)) {
			problems.push({ line: at, message: '`End` は終端として認識されません', fix: '小文字の `end` にします' });
		}
	}

	return problems;
}

export function renderMermaidReport(blocks: readonly MermaidBlock[], problems: readonly MermaidProblem[]): string {
	if (blocks.length === 0) {
		return '# Mermaid の確認\n\n```mermaid の塊が見つかりませんでした。\n';
	}
	if (problems.length === 0) {
		return [
			'# Mermaid の確認',
			'',
			`${blocks.length} 個の図を見ました。**よくある間違いは見つかりませんでした。**`,
			'',
			'図そのものは、Markdown プレビュー（`Cmd+Shift+V`）で確かめてください。',
			''
		].join('\n');
	}

	const lines = ['# Mermaid の確認', '', `${problems.length} 件。**描く前に直せるものだけ**を出しています。`, ''];
	for (const problem of problems) {
		lines.push(`- **${problem.line + 1} 行目** — ${problem.message}`, `  → ${problem.fix}`);
	}
	lines.push('', '図そのものは、Markdown プレビュー（`Cmd+Shift+V`）で確かめてください。', '');
	return lines.join('\n');
}
