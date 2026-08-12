/**
 * マシンをまたいでセッションを続ける（tasks.md T-085）。
 *
 * 会話の記録はファイルなので運べるが、**運んで困るのは会話ではなく前提のほう**。
 * 束には記録と一緒に「そのとき何を前提にしていたか」を入れ、入れる前に手元と突き合わせる。
 *
 * 束の置き場所は選ばせるだけ（iCloud でも Dropbox でも USB でもよい）。
 * **Nimbus は運ばない** — どこを経由するかは、その人の事情の話。
 *
 * 判定と文面は `core/sessionSync.ts`。
 */
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import {
	buildResumePrompt,
	bundleName,
	compareEnvironment,
	describeComparison,
	parseManifest,
	renderManifest,
	type LocalState,
	type SyncManifest
} from './core/sessionSync';
import { projectDirName } from './core/transcripts';
import { browseUrl } from './core/wikiExport';
import { pickWorkspaceRoot } from './workspaceRoots';

export interface SessionSyncDeps {
	send: (text: string) => void;
	log: (message: string) => void;
	/** いま動いているセッションの ID（無ければ記録から拾う） */
	activeSessionId: () => string | undefined;
}

/**
 * その作業ディレクトリの、いちばん新しい記録。
 *
 * 置き場所の決めかたは `core/transcripts.ts` の `projectDirName` に合わせる
 * （記録は Claude Code のもので、Nimbus が決めた場所ではない）。
 */
function newestTranscript(root: string): { uri: vscode.Uri; sessionId: string } | undefined {
	const dir = path.join(os.homedir(), '.claude', 'projects', projectDirName(root));
	let names: string[];
	try {
		names = fs.readdirSync(dir);
	} catch {
		return undefined;
	}
	let newest: { file: string; mtime: number } | undefined;
	for (const name of names) {
		if (!name.endsWith('.jsonl')) {
			continue;
		}
		try {
			const mtime = fs.statSync(path.join(dir, name)).mtimeMs;
			if (!newest || mtime > newest.mtime) {
				newest = { file: name, mtime };
			}
		} catch {
			continue;
		}
	}
	if (!newest) {
		return undefined;
	}
	return {
		uri: vscode.Uri.file(path.join(dir, newest.file)),
		sessionId: newest.file.replace(/\.jsonl$/, '')
	};
}

function git(cwd: string, args: string[]): Promise<string> {
	return new Promise((resolve) => {
		execFile('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
			resolve(error ? '' : stdout.trim());
		});
	});
}

async function localState(cwd: string): Promise<LocalState> {
	const [remote, branch, head, status] = await Promise.all([
		git(cwd, ['remote', 'get-url', 'origin']),
		git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
		git(cwd, ['rev-parse', 'HEAD']),
		git(cwd, ['status', '--porcelain'])
	]);
	return {
		repoUrl: browseUrl(remote),
		branch: branch || undefined,
		head: head || undefined,
		dirty: status.length > 0
	};
}

/** いまのセッションを、持ち運べる束にする */
export async function exportSession(deps: SessionSyncDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const newest = newestTranscript(folder.uri.fsPath);
	if (!newest) {
		void vscode.window.showInformationMessage('Nimbus: 出せるセッションがありません（先に会話を始めてください）。');
		return;
	}
	const transcript = newest.uri;
	const sessionId = deps.activeSessionId() ?? newest.sessionId;

	const note = await vscode.window.showInputBox({
		title: '続きの自分へのメモ',
		placeHolder: '例: 承認まわりを直している途中',
		prompt: '空でも進めます'
	});
	if (note === undefined) {
		return;
	}

	const state = await localState(folder.uri.fsPath);
	const manifest: SyncManifest = {
		version: 1,
		sessionId,
		repoUrl: state.repoUrl,
		branch: state.branch,
		head: state.head,
		dirty: state.dirty,
		machine: os.hostname(),
		exportedAt: new Date().toISOString(),
		transcriptFile: 'transcript.jsonl',
		note: note || undefined
	};

	const picked = await vscode.window.showOpenDialog({
		title: '束を置く場所（同期しているフォルダなど）',
		canSelectFiles: false,
		canSelectFolders: true,
		openLabel: 'ここに出す'
	});
	if (!picked || picked.length === 0) {
		return;
	}

	const target = vscode.Uri.joinPath(picked[0], bundleName(manifest));
	try {
		await vscode.workspace.fs.createDirectory(target);
		await vscode.workspace.fs.copy(transcript, vscode.Uri.joinPath(target, manifest.transcriptFile), {
			overwrite: true
		});
		await vscode.workspace.fs.writeFile(
			vscode.Uri.joinPath(target, 'nimbus-session.json'),
			new TextEncoder().encode(renderManifest(manifest))
		);
	} catch (error) {
		deps.log(`[sync] 出せませんでした: ${error instanceof Error ? error.message : String(error)}`);
		void vscode.window.showErrorMessage('Nimbus: 束を出せませんでした。');
		return;
	}

	deps.log(`[sync] ${target.fsPath} に出しました`);
	void vscode.window.showInformationMessage(`Nimbus: ${bundleName(manifest)} に出しました。`, {
		detail: [
			target.fsPath,
			'',
			'別のマシンで「別のマシンから続きを入れる」を選ぶと、手元と突き合わせてから続けられます。',
			'※ コミットしていない変更は束に入りません（先に push するか、WIP コミットを作ってください）。'
		].join('\n'),
		modal: false
	});
}

/** 別のマシンで出した束を入れる。**入れる前に突き合わせる** */
export async function importSession(deps: SessionSyncDeps): Promise<void> {
	const folder = await pickWorkspaceRoot();
	if (!folder) {
		return;
	}
	const picked = await vscode.window.showOpenDialog({
		title: '入れる束（nimbus-session.json のあるフォルダ）',
		canSelectFiles: false,
		canSelectFolders: true,
		openLabel: 'これを入れる'
	});
	if (!picked || picked.length === 0) {
		return;
	}

	let manifest: SyncManifest | undefined;
	try {
		const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(picked[0], 'nimbus-session.json'));
		manifest = parseManifest(new TextDecoder().decode(bytes));
	} catch {
		manifest = undefined;
	}
	if (!manifest) {
		void vscode.window.showErrorMessage(
			'Nimbus: 束を読めませんでした（nimbus-session.json が無いか、形が違います）。'
		);
		return;
	}

	const comparison = compareEnvironment(manifest, await localState(folder.uri.fsPath));
	const summary = describeComparison(manifest, comparison);
	deps.log(`[sync] ${summary.split('\n')[0]}`);

	if (comparison.verdict === 'stop') {
		void vscode.window.showErrorMessage(`Nimbus: ${summary.split('\n')[0]}`, {
			detail: summary,
			modal: false
		});
		return;
	}

	const CONTINUE = '続きに入る';
	const choice = await (comparison.verdict === 'warn'
		? vscode.window.showWarningMessage(`Nimbus: ${summary.split('\n')[0]}`, { detail: summary, modal: false }, CONTINUE)
		: vscode.window.showInformationMessage(
				`Nimbus: ${summary.split('\n')[0]}`,
				{ detail: summary, modal: false },
				CONTINUE
			));
	if (choice !== CONTINUE) {
		return;
	}

	const prompt = buildResumePrompt(comparison);
	if (prompt.length > 0) {
		deps.send(prompt);
		return;
	}
	void vscode.window.showInformationMessage('Nimbus: 同じ状態です。そのまま続けられます。');
}
