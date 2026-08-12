/**
 * 会話の中で決まったことを記録に残す（tasks.md T-060）。
 *
 * 設計の判断は**会話の中で決まって、会話と一緒に消える**。
 * 半年後に「なぜこうなっているのか」を誰も説明できないのは、この取りこぼしが原因。
 *
 * ここでやるのは「決めたことらしい発言を拾う」ところまで。
 * 文章にするのはセッション側で、**なぜそう決めたかを書かせる**のが要点。
 *
 * VS Code に依存しない。
 */

/** 判断らしい言い回し。日本語の会話でそのまま出てくる形に絞る */
const DECISION_PATTERNS = [
	/(?:に|へ)(?:する|した|します|しました)(?:。|$)/,
	/(?:は)?(?:しない|しません|やめる|やめた|やめます|見送る|見送った|見送ります)(?:。|$)/,
	/(?:を)?採用(?:する|した|します)?(?:。|$)/,
	/と決め(?:た|ました)(?:。|$)/,
	/方針(?:に|で)(?:する|した|いく)/,
	/(?:こちら|そちら)に寄せ(?:る|た)/
];

/** 拾わない前置き。手順や状況説明を判断として残さない */
const NOISE = /^(?:まず|次に|それでは|では|ここで|いま|今|なお|ちなみに)/;

function sentences(text: string): string[] {
	return text
		.split(/\n+/)
		.flatMap((line) => line.split(/(?<=。)/))
		.map((line) => line.replace(/^[-*\s]+/, '').trim())
		.filter((line) => line.length > 0);
}

/**
 * 会話から「決めたこと」らしい文を拾う。
 * **多少取りこぼしても、関係ない文を混ぜない方がいい** — 後で読む人が信用できなくなる。
 */
export function extractDecisions(texts: readonly string[], limit = 12): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const text of texts) {
		for (const sentence of sentences(text)) {
			if (sentence.length < 8 || sentence.length > 200 || NOISE.test(sentence)) {
				continue;
			}
			if (!DECISION_PATTERNS.some((pattern) => pattern.test(sentence))) {
				continue;
			}
			const key = sentence.replace(/\s+/g, '');
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			found.push(sentence);
			if (found.length >= limit) {
				return found;
			}
		}
	}
	return found;
}

/** 既にある ADR のファイル名から、次の番号を決める */
export function nextAdrNumber(existing: readonly string[]): number {
	let max = 0;
	for (const name of existing) {
		const match = /^(\d{4})-/.exec(name);
		if (match) {
			max = Math.max(max, Number(match[1]));
		}
	}
	return max + 1;
}

/** `0003-authentication-tokens.md`。番号で並ぶことが大事なので 4 桁で固定する */
export function adrFileName(numbered: number, title: string): string {
	const slug = title
		.trim()
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${String(numbered).padStart(4, '0')}-${slug || 'decision'}.md`;
}

export interface AdrInput {
	number: number;
	title: string;
	/** `2026-08-13` */
	date: string;
	decisions: readonly string[];
	/** きっかけになった指示（あれば） */
	instructions?: readonly string[];
	/** 触ったファイル（あれば） */
	touchedFiles?: readonly string[];
}

/**
 * ADR の下書き。
 * **「なぜ」と「選ばなかった案」を空欄として必ず置く** — 埋まっていない方が、
 * 埋まったふりをしているより正しい。
 */
export function renderAdr(input: AdrInput): string {
	const lines = [
		`# ${String(input.number).padStart(4, '0')}. ${input.title}`,
		'',
		`- 日付: ${input.date}`,
		'- 状態: 提案（決まったら「採用」に変える）',
		'',
		'## 背景',
		'',
		'（何が問題で、なぜ決める必要があったか）',
		''
	];
	if (input.instructions && input.instructions.length > 0) {
		lines.push('きっかけになった指示:', '', ...input.instructions.map((text) => `- ${text}`), '');
	}
	lines.push('## 決めたこと', '');
	if (input.decisions.length > 0) {
		lines.push(...input.decisions.map((text) => `- ${text}\n  - なぜ: （ここを埋める）`), '');
	} else {
		lines.push('- （ここを埋める）', '  - なぜ: （ここを埋める）', '');
	}
	lines.push('## 選ばなかった案', '', '- （案と、選ばなかった理由）', '');
	if (input.touchedFiles && input.touchedFiles.length > 0) {
		lines.push('## この判断で触ったファイル', '', ...input.touchedFiles.map((path) => `- \`${path}\``), '');
	}
	lines.push('## 影響', '', '（この判断が、あとで何を縛るか）', '');
	return lines.join('\n');
}

/** この製品の仕様書の型（既存の `nimbus/docs/specs/*.md` に合わせる） */
export function specTemplate(title: string): string {
	return [
		`# ${title}`,
		'',
		'（何のための機能か。何が問題で、なぜこれが要るのかを 2〜3 行で）',
		'',
		'## 振る舞い',
		'',
		'## 決めたこと',
		'',
		'## 確認すること',
		'',
		'## 残っていること',
		''
	].join('\n');
}

/**
 * セッションへ投入する文。
 * **決めたことだけでなく「なぜ」を書かせる**のが目的。理由の無い記録は、次に読む人を縛るだけ。
 */
export function buildAdrPrompt(decisions: readonly string[], specPath: string, title: string): string {
	const parts = [
		`この会話で決まったことを ${specPath} に残してください。`,
		'',
		'書き方は既存の `nimbus/docs/specs/*.md` に合わせてください（見出しの型は下に置きます）。'
	];
	if (decisions.length > 0) {
		parts.push('', 'この会話から拾った「決めたことらしい発言」です。**取りこぼしと誤検出があります**ので、鵜呑みにせず直してください:', '');
		parts.push(...decisions.map((decision) => `- ${decision}`));
	} else {
		parts.push('', '機械では判断らしい発言を拾えませんでした。会話を読み直して書き起こしてください。');
	}
	parts.push(
		'',
		'**決めたことには必ず「なぜそう決めたか」を添えてください。** 理由の無い記録は、',
		'次に読む人を縛るだけで、判断し直すこともできません。',
		'',
		'検討したが選ばなかった案があれば、それも理由つきで残してください。',
		'',
		'型:',
		'````markdown',
		specTemplate(title),
		'````'
	);
	return parts.join('\n');
}
