/**
 * マシンをまたいでセッションを続ける（tasks.md T-085）。
 *
 * 会社の Mac で始めて、家の PC で続きを見たい。会話の記録はファイルなので運べるが、
 * **運んで困るのは会話ではなく前提のほう**。
 *
 * エージェントは「さっき直した `a.ts` は今こうなっている」という前提で話を続ける。
 * 別のマシンでその前提が崩れていると、**崩れていることに気づかないまま**続きを書く。
 * これがいちばん危ない — 会話は自然に繋がって見えるのに、指している先が違う。
 *
 * だから運ぶのは会話だけではなく、**その会話が前提にしていた状態**も一緒に運び、
 * 入れる前に手元と突き合わせる。
 *
 * **合わないときに止める判断は人がする。** 機械は「何が違うか」を出すところまで。
 *
 * VS Code に依存しない。
 */

export interface SyncManifest {
	/** 束の形式。将来変わったときに読み分けるため */
	version: 1;
	sessionId: string;
	/** どのリポジトリの話か */
	repoUrl?: string;
	branch?: string;
	/** 出したときの HEAD */
	head?: string;
	/** 出したとき、コミットしていない変更があったか */
	dirty: boolean;
	/** どのマシンから出したか（人が見て分かる名前） */
	machine?: string;
	/** ISO 8601 */
	exportedAt: string;
	/** 束の中の記録ファイル名 */
	transcriptFile: string;
	/** 人が書いたメモ */
	note?: string;
}

export interface LocalState {
	repoUrl?: string;
	branch?: string;
	head?: string;
	dirty: boolean;
}

export function parseManifest(json: string): SyncManifest | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch {
		return undefined;
	}
	if (typeof raw !== 'object' || raw === null) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	if (record.version !== 1 || typeof record.sessionId !== 'string' || typeof record.transcriptFile !== 'string') {
		return undefined;
	}
	const text = (key: string): string | undefined =>
		typeof record[key] === 'string' ? (record[key] as string) : undefined;
	return {
		version: 1,
		sessionId: record.sessionId,
		repoUrl: text('repoUrl'),
		branch: text('branch'),
		head: text('head'),
		dirty: record.dirty === true,
		machine: text('machine'),
		exportedAt: text('exportedAt') ?? '',
		transcriptFile: record.transcriptFile,
		note: text('note')
	};
}

export type ResumeVerdict = 'ok' | 'warn' | 'stop';

export interface Comparison {
	verdict: ResumeVerdict;
	/** 何が違うか。**違いは全部挙げる**（黙って続けない） */
	differences: string[];
}

/**
 * 手元と突き合わせる。
 *
 * - **別のリポジトリなら止める。** 会話の前提が丸ごと違う
 * - **HEAD が違う / どちらかが汚れているなら警告。** 続けられるが、ずれている
 * - 枝が違うのは警告どまり（同じ HEAD を指していることもある）
 */
export function compareEnvironment(manifest: SyncManifest, local: LocalState): Comparison {
	const differences: string[] = [];
	let verdict: ResumeVerdict = 'ok';

	if (manifest.repoUrl && local.repoUrl && manifest.repoUrl !== local.repoUrl) {
		differences.push(`別のリポジトリです（${manifest.repoUrl} → ${local.repoUrl}）`);
		verdict = 'stop';
	}
	if (manifest.branch && local.branch && manifest.branch !== local.branch) {
		differences.push(`枝が違います（${manifest.branch} → ${local.branch}）`);
		if (verdict === 'ok') {
			verdict = 'warn';
		}
	}
	if (manifest.head && local.head && manifest.head !== local.head) {
		differences.push(`コミットが違います（${manifest.head.slice(0, 8)} → ${local.head.slice(0, 8)}）`);
		if (verdict === 'ok') {
			verdict = 'warn';
		}
	}
	if (manifest.dirty) {
		differences.push('出したとき、コミットしていない変更がありました（その内容はここにはありません）');
		if (verdict === 'ok') {
			verdict = 'warn';
		}
	}
	if (local.dirty) {
		differences.push('こちらにコミットしていない変更があります');
		if (verdict === 'ok') {
			verdict = 'warn';
		}
	}
	return { verdict, differences };
}

const VERDICT_HEAD: Record<ResumeVerdict, string> = {
	ok: '同じ状態です。そのまま続けられます',
	warn: '続けられますが、出したときと状態が違います',
	stop: '続けないでください。前提が丸ごと違います'
};

/** 画面に出す説明 */
export function describeComparison(manifest: SyncManifest, comparison: Comparison): string {
	const lines = [VERDICT_HEAD[comparison.verdict]];
	if (manifest.machine) {
		lines.push(`  出どころ: ${manifest.machine}${manifest.exportedAt ? `（${manifest.exportedAt}）` : ''}`);
	}
	if (manifest.note) {
		lines.push(`  メモ: ${manifest.note}`);
	}
	for (const difference of comparison.differences) {
		lines.push(`  ${difference}`);
	}
	return lines.join('\n');
}

/**
 * 続きに入る前にエージェントへ渡す文。
 *
 * **ずれていることを先に言う。** 言わずに続けると、
 * 「さっき直したファイル」を今の中身だと思ったまま話が進む。
 */
export function buildResumePrompt(comparison: Comparison): string {
	if (comparison.verdict === 'ok') {
		return '';
	}
	return [
		'別のマシンで続けていた会話の続きです。**そのときとファイルの状態が違います。**',
		'',
		...comparison.differences.map((difference) => `- ${difference}`),
		'',
		'進める前に:',
		'',
		'1. **話に出てくるファイルを読み直してください。** 会話にある内容は、今の中身とは違うかもしれません',
		'2. 直したはずの変更が**入っていない**なら、そう言ってください。やり直すかは私が決めます',
		'3. **覚えているつもりで書かないでください。** 読んでから書いてください'
	].join('\n');
}

/** 束の名前。人が見て、どれがどれか分かる形にする */
export function bundleName(manifest: SyncManifest): string {
	const stamp = manifest.exportedAt
		.replace(/[-:]/g, '')
		// 小数の秒と末尾の Z は名前に要らない
		.replace(/(?:\.\d+)?Z?$/, '')
		.replace('T', '-');
	const branch = (manifest.branch ?? 'session').replace(/[^\w.-]/g, '-');
	return `nimbus-${branch}-${stamp || 'export'}`;
}

/** 束に入れるマニフェスト */
export function renderManifest(manifest: SyncManifest): string {
	return `${JSON.stringify(manifest, null, 2)}\n`;
}
