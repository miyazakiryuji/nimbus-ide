/**
 * 秘匿ファイルの読み取り禁止（tasks.md T-164）。
 *
 * 「文脈に入れない」（T-155）とは別で、こちらは**読み取り自体を止める**。
 * 一度読まれてしまえば、その内容はもうモデルへの入力に乗っている。承認ダイアログで
 * 利用者が「許可」を押し間違える余地を残さず、Nimbus 側で先に断る。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/**
 * 既定の対象。**取り漏らしより誤検知を選ぶ**方向に倒してある
 * （読めなくて困ったら設定 `nimbus.safety.protectedPaths` で外せるが、読まれてからでは戻せない）。
 * `!` 始まりは除外規則。雛形（`.env.example`）まで読めなくなるのは行き過ぎなので先に抜く。
 */
export const DEFAULT_PROTECTED_GLOBS: readonly string[] = [
	'**/.env',
	'**/.env.*',
	'!**/.env.example',
	'!**/.env.sample',
	'!**/.env.template',
	'!**/.env.defaults',
	'**/*.pem',
	'**/*.key',
	'!**/*.public.key',
	'**/*.p12',
	'**/*.pfx',
	'**/*.keystore',
	'**/*.jks',
	'**/*.mobileprovision',
	'**/id_rsa',
	'**/id_dsa',
	'**/id_ecdsa',
	'**/id_ed25519',
	'**/.ssh/**',
	'**/.gnupg/**',
	'**/.aws/credentials',
	'**/.npmrc',
	'**/.netrc',
	'**/.pgpass',
	'**/secrets.json',
	'**/secrets.ya?ml',
	'**/serviceAccount*.json',
	'**/*.jks.password'
];

/** 内容を覗ける（＝持ち出せる）シェルコマンド。ここに載るものは Bash 経路でも止める */
const READING_COMMANDS =
	/\b(cat|bat|less|more|head|tail|nl|xxd|od|strings|grep|egrep|fgrep|rg|ag|awk|sed|cp|rsync|scp|open|pbcopy|base64|dotenv|source)\b/;

/**
 * glob を正規表現にする。対応するのは `**` / `*` / `?` の 3 つだけ。
 * minimatch を持ち込まないのは、依存を増やしてまで必要な表現力がここに無いため。
 */
export function globToRegExp(glob: string): RegExp {
	let out = '';
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === '*') {
			if (glob[i + 1] === '*') {
				// `**/` は「0 個以上のディレクトリ」。`a/**/b` が `a/b` にも当たるようにする
				if (glob[i + 2] === '/') {
					out += '(?:[^/]*/)*';
					i += 2;
				} else {
					out += '.*';
					i += 1;
				}
			} else {
				out += '[^/]*';
			}
		} else if (char === '?') {
			out += '[^/]';
		} else {
			out += char.replace(/[.+^${}()|[\]\\]/, '\\$&');
		}
	}
	return new RegExp(`^${out}$`);
}

/** パス区切りを `/` に揃える（Windows と macOS で同じ規則が効くように） */
function normalize(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

/**
 * 除外規則（`!`）を後勝ちで効かせた判定。
 * 肯定パターンのどれかに当たり、否定パターンのどれにも当たらないときだけ true。
 */
export function isProtectedPath(filePath: string, globs: readonly string[] = DEFAULT_PROTECTED_GLOBS): boolean {
	const path = normalize(filePath);
	let protectedByPositive = false;
	for (const glob of globs) {
		const negated = glob.startsWith('!');
		const pattern = negated ? glob.slice(1) : glob;
		if (!globToRegExp(pattern).test(path)) {
			continue;
		}
		if (negated) {
			return false;
		}
		protectedByPositive = true;
	}
	return protectedByPositive;
}

export interface BlockedRead {
	/** 止めた対象のパス（利用者に見せる） */
	path: string;
	/** どの経路で読もうとしたか */
	via: 'tool' | 'command';
}

/** 読み取り経路のツール。Write / Edit は「読める」経路ではないので対象外 */
const READ_TOOLS = new Set(['Read', 'NotebookRead']);

/**
 * このツール呼び出しが秘匿ファイルを読もうとしているかを判定する。
 * Bash は「読めるコマンド」に秘匿パスが現れたときだけ止める
 * （`echo x >> .env` のような書き込みまで止めると、開発の邪魔をするだけになる）。
 */
export function findBlockedRead(
	toolName: string,
	input: unknown,
	globs: readonly string[] = DEFAULT_PROTECTED_GLOBS
): BlockedRead | undefined {
	if (!input || typeof input !== 'object') {
		return undefined;
	}
	const record = input as Record<string, unknown>;

	if (READ_TOOLS.has(toolName)) {
		const path = record['file_path'] ?? record['path'] ?? record['notebook_path'];
		if (typeof path === 'string' && isProtectedPath(path, globs)) {
			return { path, via: 'tool' };
		}
		return undefined;
	}

	if (toolName === 'Bash' && typeof record['command'] === 'string') {
		const command = record['command'];
		if (!READING_COMMANDS.test(command)) {
			return undefined;
		}
		// クォート・リダイレクトを剥がしてから、引数ごとに突き合わせる
		for (const token of command.split(/[\s;&|<>()]+/)) {
			const path = token.replace(/^['"]|['"]$/g, '');
			if (path && isProtectedPath(path, globs)) {
				return { path, via: 'command' };
			}
		}
	}
	return undefined;
}
