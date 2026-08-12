/**
 * 危ない書き方を見つける（tasks.md T-202 生成コードの脆弱性スキャン）。
 *
 * エージェントが書くコードは**動くように書かれる**。動けばいいなら、検証を切るのも、
 * 文字列を繋いで SQL を作るのも早い。そこを人が毎回読むのは続かないので、機械で拾う。
 *
 * 見るのは**書き方**だけ。実際に危ないかは文脈による（テスト用かもしれない）ので、
 * **断定しない**。「なぜ危ないか」と「代わりに何を使うか」を添えて、判断は人に渡す。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface VulnFinding {
	file: string;
	line: number;
	rule: string;
	message: string;
	/** 代わりに何をすればいいか */
	fix: string;
}

interface Rule {
	id: string;
	pattern: RegExp;
	message: string;
	fix: string;
	/** これに当たる行は見逃す（テストや設定など） */
	skip?: RegExp;
}

const RULES: Rule[] = [
	{
		id: 'tls-disabled',
		pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0|badCertificateCallback\s*=/,
		message: '通信相手の証明書を確かめずに繋いでいます',
		fix: '証明書を検証したまま繋ぐ。自己署名を使うなら、その証明書だけを信頼リストに足す'
	},
	{
		id: 'shell-injection',
		pattern: /\b(exec|execSync|spawnSync)\s*\(\s*[`'"][^`'"]*\$\{|\bshell\s*:\s*true/,
		message: '組み立てた文字列をシェルに渡しています（入力次第で任意のコマンドが動きます）',
		fix: '`execFile` に配列で引数を渡す（シェルを通さない）'
	},
	{
		id: 'sql-concat',
		pattern: /(SELECT|INSERT|UPDATE|DELETE)[^;'"]*['"`]\s*\+|\$\{[^}]+\}\s*(?:WHERE|VALUES|SET)\b/i,
		message: '文字列を繋いで SQL を作っています',
		fix: 'プレースホルダ（`?` / `$1`）とパラメータで渡す'
	},
	{
		id: 'weak-hash',
		pattern: /createHash\(\s*['"](md5|sha1)['"]|\bmd5\s*\(/i,
		message: 'MD5 / SHA-1 は壊れています（衝突が作れます）',
		fix: 'ハッシュなら SHA-256、パスワードなら bcrypt / argon2',
		// チェックサムや ETag のように、安全性を求めない用途はある
		skip: /checksum|etag|cache|fingerprint/i
	},
	{
		id: 'insecure-random',
		pattern: /Math\.random\(\)/,
		message: '推測できる乱数です',
		fix: '鍵・トークン・ID には `crypto.randomUUID()` や `crypto.getRandomValues`',
		// 見た目の揺らぎや遅延のばらつきなど、当てられても困らない用途は多い
		skip: /jitter|shuffle|sample|animation|delay|color/i
	},
	{
		id: 'eval',
		pattern: /\beval\s*\(|new\s+Function\s*\(/,
		message: '文字列をコードとして実行しています',
		fix: '解釈が要るなら JSON など、実行しない形にする'
	},
	{
		id: 'http-url',
		pattern: /['"]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/,
		message: '暗号化されていない通信です（途中で読まれます）',
		fix: '`https://` を使う。相手が対応していないなら、その旨を記録に残す'
	}
];

/** コメント行は見ない（説明のために書いてあることが多い） */
function isComment(line: string): boolean {
	const text = line.trim();
	return text.startsWith('//') || text.startsWith('*') || text.startsWith('#');
}

export function scanSource(file: string, content: string): VulnFinding[] {
	const findings: VulnFinding[] = [];
	const lines = content.split('\n');

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (isComment(line)) {
			continue;
		}
		for (const rule of RULES) {
			if (!rule.pattern.test(line)) {
				continue;
			}
			if (rule.skip?.test(line)) {
				continue;
			}
			findings.push({ file, line: i, rule: rule.id, message: rule.message, fix: rule.fix });
		}
	}
	return findings;
}

/** テストや例のファイルは、危ない書き方をわざとすることがある */
export function isExampleFile(path: string): boolean {
	return /(^|\/)(test|tests|spec|__tests__|example|examples|fixtures?)\//.test(path) || /\.(test|spec)\./.test(path);
}

export function renderVulnFindings(findings: readonly VulnFinding[]): string {
	if (findings.length === 0) {
		return '';
	}

	const lines = [
		'## 危ない書き方',
		'',
		`${findings.length} 件。**実際に危ないかは文脈によります**（テスト用かもしれません）。`,
		'見て、そのままでよければそのままにしてください。',
		''
	];

	const byRule = new Map<string, VulnFinding[]>();
	for (const finding of findings) {
		byRule.set(finding.rule, [...(byRule.get(finding.rule) ?? []), finding]);
	}

	for (const [, rows] of byRule) {
		const first = rows[0];
		lines.push(`### ${first.message}`, '', `→ ${first.fix}`, '');
		for (const row of rows.slice(0, 10)) {
			lines.push(`- \`${row.file}:${row.line + 1}\``);
		}
		if (rows.length > 10) {
			lines.push(`- …ほか ${rows.length - 10} 件`);
		}
		lines.push('');
	}

	return lines.join('\n');
}
