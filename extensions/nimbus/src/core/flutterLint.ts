/**
 * Flutter のソースから、外に出す前に気づきたいことを拾う
 * （tasks.md T-194 i18n の抽出 / T-195 アクセシビリティ）。
 *
 * どちらも「動くので気づかない」たぐいのもの。日本語のまま出荷される文言も、
 * 読み上げに何も渡らない画像も、動作としては正しく見える。
 *
 * 構文解析はしない（`analyzer` を持ち込むと同梱物が増える）。行の見た目で拾い、
 * **迷ったら拾わない**。誤検知が続くと、この手の指摘は読まれなくなる。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface SourceFinding {
	file: string;
	line: number;
	text: string;
	kind: 'hardcoded-text' | 'missing-semantics' | 'missing-tooltip';
	hint: string;
}

/** `Text('...')` / `Text("...")` の直書き。`Text(l10n.x)` のような参照は拾わない */
const HARDCODED_TEXT = /\bText\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1/;

/** すでに国際化されている呼び出し。これらが同じ行にあれば触らない */
const LOCALIZED = /\b(AppLocalizations|l10n|S\.of|intl|tr\(|context\.l10n)/;

/** 読み上げに何も渡らない画像 */
const IMAGE = /\bImage\.(asset|network|file|memory)\(/;
const HAS_SEMANTIC_LABEL = /semanticLabel\s*:/;

/** 押せるのに名前が無いボタン */
const ICON_BUTTON = /\bIconButton\(/;
const HAS_TOOLTIP = /tooltip\s*:/;

/** 文字列に日本語が含まれるか（英語の識別子と区別するため） */
function hasJapanese(text: string): boolean {
	return /[぀-ヿ一-龯]/.test(text);
}

/**
 * ウィジェットの引数は複数行に散るので、**次の数行もあわせて見る**。
 * 1 行だけ見ると `IconButton(\n  tooltip: …` を「無い」と誤って言ってしまう。
 */
function windowAt(lines: readonly string[], index: number, span = 6): string {
	return lines.slice(index, index + span).join('\n');
}

export function lintFlutterSource(file: string, content: string): SourceFinding[] {
	const findings: SourceFinding[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().startsWith('//')) {
			continue;
		}

		const text = HARDCODED_TEXT.exec(line);
		if (text && !LOCALIZED.test(line) && hasJapanese(text[2])) {
			findings.push({
				file,
				line: i,
				text: text[2],
				kind: 'hardcoded-text',
				hint: '画面に出る文言が直書きです。`.arb` に出すと、翻訳も表記ゆれの修正も 1 か所で済みます'
			});
		}

		if (IMAGE.test(line) && !HAS_SEMANTIC_LABEL.test(windowAt(lines, i))) {
			findings.push({
				file,
				line: i,
				text: line.trim().slice(0, 60),
				kind: 'missing-semantics',
				hint: '`semanticLabel` が無いので、読み上げに何も渡りません（装飾なら `excludeFromSemantics: true`）'
			});
		}

		if (ICON_BUTTON.test(line) && !HAS_TOOLTIP.test(windowAt(lines, i))) {
			findings.push({
				file,
				line: i,
				text: line.trim().slice(0, 60),
				kind: 'missing-tooltip',
				hint: '`tooltip` が無いので、押せるのに名前がありません（読み上げにも出ません）'
			});
		}
	}

	return findings;
}

const KIND_TITLE: Record<SourceFinding['kind'], string> = {
	'hardcoded-text': '直書きの文言',
	'missing-semantics': '読み上げに渡らない画像',
	'missing-tooltip': '名前の無いボタン'
};

/** `.arb` に足す形（キーは人が決めるので、値だけを並べる） */
export function suggestArbEntries(findings: readonly SourceFinding[]): string {
	const texts = [...new Set(findings.filter((f) => f.kind === 'hardcoded-text').map((f) => f.text))];
	if (texts.length === 0) {
		return '';
	}
	const entries = texts.map((text, index) => `  "message${index + 1}": ${JSON.stringify(text)}`);
	return ['```json', '{', entries.join(',\n'), '}', '```'].join('\n');
}

export function renderFlutterLint(findings: readonly SourceFinding[]): string {
	if (findings.length === 0) {
		return '# Flutter の確認\n\n気になるところは見つかりませんでした。\n';
	}

	const lines = ['# Flutter の確認', '', `${findings.length} 件。**直すかどうかは人が決めてください。**`, ''];

	for (const kind of ['hardcoded-text', 'missing-semantics', 'missing-tooltip'] as const) {
		const rows = findings.filter((finding) => finding.kind === kind);
		if (rows.length === 0) {
			continue;
		}
		lines.push(`## ${KIND_TITLE[kind]}（${rows.length}）`, '', rows[0].hint, '');
		for (const row of rows.slice(0, 20)) {
			lines.push(`- \`${row.file}:${row.line + 1}\` — ${row.text}`);
		}
		if (rows.length > 20) {
			lines.push(`- …ほか ${rows.length - 20} 件`);
		}
		lines.push('');
	}

	const arb = suggestArbEntries(findings);
	if (arb) {
		lines.push('## `.arb` に足すなら', '', 'キーは中身が分かる名前に置き換えてください。', '', arb, '');
	}

	return lines.join('\n');
}
