/**
 * コメントだけが古くなっている場所を見つける（tasks.md T-210）。
 *
 * コードは直っているのにコメントが直っていない、は静かに効く。**読む人は本文より
 * コメントを信じる**し、エージェントも同じで、古い前提を正として次を書いてしまう。
 *
 * 判定できるのは「機械的に突き合わせられるもの」だけ。文章の意味は見ない
 * （意味まで判定しようとすると誤検知が増えて、指摘そのものが読まれなくなる）。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface CommentFinding {
	file: string;
	line: number;
	kind: 'param-mismatch' | 'dead-reference';
	message: string;
}

/** `@param name` の名前 */
const JSDOC_PARAM = /@param\s+(?:\{[^}]*\}\s*)?([A-Za-z_$][\w$]*)/g;

/** 関数・メソッドの引数リスト（1 行に収まっているものだけを見る） */
const SIGNATURE = /(?:function\s+[\w$]*|\b[\w$]+)\s*\(([^)]*)\)/;

/**
 * コメントの中のファイル参照（`foo.ts` / `core/bar.ts`）。
 * `.md` は入れない — `CLAUDE.md` のように**コード以外の場所にある**ものを指すことが多く、
 * 突き合わせる相手がいないのに「見つかりません」と言ってしまう（実データで出た）。
 */
const FILE_REFERENCE = /(?:^|[\s(`'"])([\w./-]+\.(?:ts|tsx|js|dart))(?=[\s)`'".,、。]|$)/g;

function paramNames(signature: string): string[] {
	const match = SIGNATURE.exec(signature);
	if (!match) {
		return [];
	}
	return match[1]
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			// `private readonly foo: T = x` → `foo`。
			// 修飾子は**連続する**ので、まとめて外す（1 つだけ外すと `readonly` を名前と読む）
			const cleaned = part.replace(/^(?:(?:public|private|protected|readonly|static|override)\s+)+/, '').replace(/^\.\.\./, '');
			return /^([A-Za-z_$][\w$]*)/.exec(cleaned)?.[1] ?? '';
		})
		.filter(Boolean);
}

/**
 * JSDoc の `@param` と、その直後の関数の引数を突き合わせる。
 *
 * **引数の側に無い名前だけ**を挙げる。逆（書かれていない引数）は普通にあることなので言わない。
 */
export function findParamMismatches(file: string, content: string): CommentFinding[] {
	const lines = content.split('\n');
	const findings: CommentFinding[] = [];

	for (let i = 0; i < lines.length; i++) {
		// **コメント行だけを見る。** ソースの中の正規表現や文字列にも `@param` は現れるので、
		// 素通しにすると自分自身のコードを指摘してしまう（実データで出た）
		const commentLine = lines[i].trim();
		if (!lines[i].includes('@param') || (!commentLine.startsWith('*') && !commentLine.startsWith('//'))) {
			continue;
		}
		// コメント塊の終わりを探し、その次の中身のある行を関数の宣言と見なす
		let end = i;
		while (end < lines.length && !lines[end].includes('*/')) {
			end++;
		}
		let signatureLine = end + 1;
		while (signatureLine < lines.length && lines[signatureLine].trim().length === 0) {
			signatureLine++;
		}
		const documented = [...lines.slice(i, end + 1).join('\n').matchAll(JSDOC_PARAM)].map((match) => match[1]);
		const actual = new Set(paramNames(lines[signatureLine] ?? ''));
		if (actual.size === 0) {
			i = end;
			continue;
		}
		for (const name of documented) {
			if (!actual.has(name)) {
				findings.push({
					file,
					line: i,
					kind: 'param-mismatch',
					message: `\`@param ${name}\` はもう引数にありません`
				});
			}
		}
		i = end;
	}
	return findings;
}

/**
 * コメントが指しているファイルが無い場合を挙げる。
 *
 * **末尾一致で照合する。** 相対パスで書かれることが多く、厳密に解決しようとすると
 * 誤検知だらけになるため。
 */
export function findDeadReferences(file: string, content: string, knownPaths: readonly string[]): CommentFinding[] {
	const findings: CommentFinding[] = [];
	const lines = content.split('\n');
	const known = knownPaths.map((path) => path.replace(/\\/g, '/'));

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		if (!trimmed.startsWith('*') && !trimmed.startsWith('//')) {
			continue;
		}
		for (const match of line.matchAll(FILE_REFERENCE)) {
			const reference = match[1].replace(/^\.\//, '');
			if (reference.startsWith('http') || reference.split('/').pop()?.startsWith('*')) {
				continue;
			}
			const exists = known.some((path) => path === reference || path.endsWith(`/${reference}`));
			if (!exists) {
				findings.push({
					file,
					line: i,
					kind: 'dead-reference',
					message: `\`${reference}\` は見つかりません（名前が変わった／消えた可能性）`
				});
			}
		}
	}
	return findings;
}

export function renderCommentFindings(findings: readonly CommentFinding[]): string {
	if (findings.length === 0) {
		return '';
	}
	const lines = [
		'## 古くなっているコメント',
		'',
		`${findings.length} 件。読む人は本文よりコメントを信じるので、直すか消すかしてください。`,
		''
	];
	for (const finding of findings.slice(0, 30)) {
		lines.push(`- \`${finding.file}:${finding.line + 1}\` — ${finding.message}`);
	}
	if (findings.length > 30) {
		lines.push(`- …ほか ${findings.length - 30} 件`);
	}
	lines.push('');
	return lines.join('\n');
}
