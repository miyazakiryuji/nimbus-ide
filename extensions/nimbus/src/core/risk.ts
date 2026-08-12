/**
 * 危険操作の事前検知（tasks.md T-058）。
 *
 * 承認ダイアログは「Claude がツールを実行しようとしています」までしか言わない。
 * それだと `rm -rf` と `ls` が同じ見た目で並ぶ。**実行したら取り返しがつかないもの**を
 * 実行前に言葉で名指しし、承認の重さを変えるのがここの役目。
 *
 * VS Code に依存しないので単体で検証できる（判断を誤ると実害が出る場所なので必ずテストする）。
 */

/** normal: ふつう / caution: 気をつける / danger: 取り返しがつかない */
export type RiskLevel = 'normal' | 'caution' | 'danger';

export interface RiskAssessment {
	level: RiskLevel;
	/** なぜ危ないと判断したか。承認ダイアログにそのまま出す文言 */
	reasons: string[];
}

interface Rule {
	level: Exclude<RiskLevel, 'normal'>;
	reason: string;
	test: (command: string) => boolean;
}

const NORMAL: RiskAssessment = { level: 'normal', reasons: [] };

function re(pattern: RegExp): (command: string) => boolean {
	return (command) => pattern.test(command);
}

/**
 * `rm` の呼び出しごとに後続のフラグを集め、再帰（r）と強制（f）が揃うかを見る。
 * `rm -rf` / `rm -fr` / `rm -r -f` / `rm --recursive --force` を等しく捕まえるため、
 * 単一の正規表現ではなくフラグの集合で判定する。
 */
function hasRecursiveForceRm(command: string): boolean {
	for (const match of command.matchAll(/\brm\b([^;&|\n]*)/g)) {
		const flags = (match[1] ?? '').match(/(?:^|\s)--?[a-zA-Z-]+/g)?.map((f) => f.trim()) ?? [];
		const short = (letter: RegExp): boolean =>
			flags.some((f) => /^-[a-zA-Z]+$/.test(f) && letter.test(f.slice(1)));
		const recursive = flags.includes('--recursive') || short(/[rR]/);
		const force = flags.includes('--force') || short(/f/);
		if (recursive && force) {
			return true;
		}
	}
	return false;
}

/** ダウンロードしたものをそのままシェルに食わせる形（`curl … | sh`） */
function isPipeToShell(command: string): boolean {
	return /\b(curl|wget|iwr)\b/i.test(command) && /\|\s*(sudo\s+)?(ba|z|k|da|fi)?sh\b/.test(command);
}

/**
 * 判定表。上から順に当て、当たったものを全部理由として並べる。
 * 「これは危険」と言い切れるものだけを danger に置く（狼少年にすると誰も読まなくなる）。
 */
const RULES: Rule[] = [
	{ level: 'danger', reason: '再帰的な強制削除（rm -rf）', test: hasRecursiveForceRm },
	{ level: 'danger', reason: '管理者権限での実行（sudo）', test: re(/(^|[;&|]\s*)sudo\s/) },
	{
		level: 'danger',
		reason: 'コミット済みの履歴を書き換える強制 push',
		// --force-with-lease は他人の変更を消さないので caution 側で拾う
		test: re(/\bgit\s+push\b[^;&|\n]*(--force(?!-with-lease)\b|(?:^|\s)-f\b)/)
	},
	{ level: 'danger', reason: '作業ツリーの巻き戻し（git reset --hard）', test: re(/\bgit\s+reset\b[^;&|\n]*--hard\b/) },
	{
		level: 'danger',
		reason: '未コミットの変更の破棄（git checkout -- / git restore）',
		test: re(/\bgit\s+(checkout\s+--(?:\s|$)|restore\b(?![^;&|\n]*--staged))/)
	},
	{ level: 'danger', reason: '追跡外ファイルの一括削除（git clean）', test: re(/\bgit\s+clean\b[^;&|\n]*-[a-zA-Z]*[fdx]/) },
	{ level: 'danger', reason: 'ディスクへの直接書き込み（dd）', test: re(/\bdd\b[^;&|\n]*\bof=\/dev\//) },
	{ level: 'danger', reason: 'ファイルシステムの作成（mkfs）', test: re(/\bmkfs(\.\w+)?\b/) },
	{ level: 'danger', reason: '誰でも書き込める権限（chmod 777）', test: re(/\bchmod\b[^;&|\n]*\b777\b/) },
	{ level: 'danger', reason: 'ダウンロードしたスクリプトの直接実行', test: isPipeToShell },
	{ level: 'danger', reason: 'fork bomb', test: re(/:\(\)\s*\{.*\|.*&.*\}\s*;\s*:/) },
	{ level: 'danger', reason: 'マシンの停止・再起動', test: re(/(^|[;&|]\s*)(shutdown|reboot|halt|poweroff)\b/) },
	{
		level: 'danger',
		reason: 'データベースの破壊的操作（DROP / TRUNCATE）',
		test: re(/\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i)
	},
	{
		level: 'danger',
		reason: '本番環境への反映',
		test: re(
			/(--prod\b|--production\b|NODE_ENV=production|\bfirebase\s+deploy\b|\bvercel\b[^;&|\n]*--prod\b|\beas\s+submit\b|\bterraform\s+apply\b|\bserverless\s+deploy\b|\bkubectl\b[^;&|\n]*--context[=\s]+\S*prod)/i
		)
	},
	{
		level: 'danger',
		reason: 'パッケージの公開（取り消せない）',
		test: re(/\b(npm\s+publish|pnpm\s+publish|yarn\s+publish|pod\s+trunk\s+push|gem\s+push|cargo\s+publish)\b/)
	},

	{ level: 'caution', reason: 'ファイルの削除', test: re(/(^|[;&|]\s*)rm\s/) },
	{ level: 'caution', reason: '履歴を書き換える push（--force-with-lease）', test: re(/\bgit\s+push\b[^;&|\n]*--force-with-lease\b/) },
	{ level: 'caution', reason: '作業中の変更の退避・破棄（git stash）', test: re(/\bgit\s+stash\b/) },
	{ level: 'caution', reason: 'ブランチの削除', test: re(/\bgit\s+branch\b[^;&|\n]*\s-[dD]\b/) },
	{ level: 'caution', reason: '所有者・権限の再帰的な変更', test: re(/\b(chown|chmod)\b[^;&|\n]*\s-R\b/) },
	{ level: 'caution', reason: 'プロセスの強制終了', test: re(/\b(killall|pkill)\b|\bkill\s+-9\b/) },
	{ level: 'caution', reason: 'コンテナ・イメージの一括削除', test: re(/\bdocker\s+(system\s+prune|rm\s+-f|rmi\s+-f)\b/) },
	{ level: 'caution', reason: '外部への送信を伴うコマンド', test: re(/\b(curl|wget)\b[^;&|\n]*\s-(d|F|-data|-upload-file)\b/) }
];

/** ビルド設定に触る変更は差分を目立たせる（tasks.md T-120） */
const BUILD_CONFIG = /(^|\/)(build\.gradle(\.kts)?|settings\.gradle(\.kts)?|gradle\.properties|Podfile|.*\.xcodeproj\/.*|.*\.xcworkspace\/.*|.*\.pbxproj|Package\.swift|AndroidManifest\.xml|Info\.plist|Dockerfile|docker-compose\.ya?ml|\.github\/workflows\/.*\.ya?ml)$/;

/** 書き換えられると環境ごと壊れる場所 */
const SYSTEM_PATH = /^(\/etc\/|\/usr\/|\/bin\/|\/sbin\/|\/System\/|\/Library\/LaunchDaemons\/)|(^|\/)\.ssh\/|(^|\/)\.aws\/|(^|\/)\.gnupg\//;

function combine(hits: Rule[]): RiskAssessment {
	if (hits.length === 0) {
		return NORMAL;
	}
	return {
		level: hits.some((r) => r.level === 'danger') ? 'danger' : 'caution',
		// 同じ理由を二度出さない（`rm -rf` は削除ルールにも当たる）
		reasons: [...new Set(hits.map((r) => r.reason))]
	};
}

/** シェルコマンド 1 本の危険度 */
export function assessCommandRisk(command: string): RiskAssessment {
	if (!command.trim()) {
		return NORMAL;
	}
	return combine(RULES.filter((rule) => rule.test(command)));
}

/** 書き込み先のパスから決まる危険度 */
export function assessPathRisk(filePath: string): RiskAssessment {
	const path = filePath.replace(/\\/g, '/');
	const hits: Rule[] = [];
	if (SYSTEM_PATH.test(path)) {
		hits.push({ level: 'danger', reason: 'システム・資格情報の置き場所への書き込み', test: () => true });
	}
	if (BUILD_CONFIG.test(path)) {
		hits.push({ level: 'caution', reason: 'ビルド設定の変更', test: () => true });
	}
	return combine(hits);
}

/** 書き込みを伴うツール。読むだけのものはパスの危険度を見ても意味がない */
const WRITING_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/** ツール呼び出し全体の危険度。実行するものはコマンド、書き込むものはパスで見る */
export function assessToolRisk(toolName: string, input: unknown): RiskAssessment {
	if (!input || typeof input !== 'object') {
		return NORMAL;
	}
	const record = input as Record<string, unknown>;
	if (typeof record['command'] === 'string') {
		return assessCommandRisk(record['command']);
	}
	if (!WRITING_TOOLS.has(toolName)) {
		return NORMAL;
	}
	const path = record['file_path'] ?? record['path'] ?? record['notebook_path'];
	return typeof path === 'string' ? assessPathRisk(path) : NORMAL;
}
