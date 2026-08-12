/**
 * スナップショット／ゴールデンテストの更新レビュー（tasks.md T-181）。
 *
 * スナップショットは**通すために更新できてしまう**。落ちたから撮り直した、が
 * そのまま通ってしまうと、テストは何も守らなくなる。
 * だから「何が更新されたのか」を、レビューの前に名指しで出す。
 *
 * VS Code に依存しない。差分の読み取りと見せ方だけを置く。
 */

/** スナップショット・ゴールデンとして扱うパス（言語ごとの慣習をそのまま使う） */
export function isSnapshotPath(path: string): boolean {
	return (
		/(^|\/)__snapshots__\//.test(path) ||
		/\.snap$/.test(path) ||
		/(^|\/)goldens?\//.test(path) ||
		/\.golden(\.\w+)?$/.test(path) ||
		/\.(approved|received)\.\w+$/.test(path) ||
		/_golden\.(png|jpg|jpeg|webp)$/.test(path)
	);
}

/** 中身を差分で読めないもの（画像など） */
export function isBinarySnapshot(path: string): boolean {
	return /\.(png|jpe?g|webp|gif|pdf|ico)$/i.test(path);
}

export type ChangeStatus = 'added' | 'modified' | 'deleted';

export interface SnapshotChange {
	path: string;
	status: ChangeStatus;
	binary: boolean;
	/** 変わったスナップショットの名前（読み取れたぶんだけ） */
	keys: string[];
}

const STATUS_LABELS: Record<ChangeStatus, string> = {
	added: '追加',
	modified: '更新',
	deleted: '削除'
};

/** `git diff --name-status` の 1 行を読む。R（改名）は「更新」として扱う */
export function parseNameStatus(output: string): { status: ChangeStatus; path: string }[] {
	const changes: { status: ChangeStatus; path: string }[] = [];
	for (const line of output.split('\n')) {
		const parts = line.split('\t');
		if (parts.length < 2) {
			continue;
		}
		const code = parts[0][0];
		// R100 のような形は最後の要素が新しいパス
		const path = parts[parts.length - 1].trim();
		if (path.length === 0) {
			continue;
		}
		if (code === 'A') {
			changes.push({ status: 'added', path });
		} else if (code === 'D') {
			changes.push({ status: 'deleted', path });
		} else if (code === 'M' || code === 'R' || code === 'C') {
			changes.push({ status: 'modified', path });
		}
	}
	return changes;
}

/** `exports[`name 1`]` の形（Jest / Vitest）から、変わった名前を拾う */
const SNAPSHOT_KEY = /^[+-]exports\[`(.+?)`\]/;

export function changedSnapshotKeys(diff: string): string[] {
	const keys = new Set<string>();
	for (const line of diff.split('\n')) {
		const match = SNAPSHOT_KEY.exec(line);
		if (match) {
			keys.add(match[1]);
		}
	}
	return [...keys];
}

/** 一覧。画像は「中身を読めない」と明示する — 読めたつもりにさせない */
export function describeSnapshotChanges(
	changes: readonly SnapshotChange[],
	displayPath: (path: string) => string
): string {
	if (changes.length === 0) {
		return 'スナップショットの更新はありません。';
	}
	const lines = changes.map((change) => {
		const keys = change.binary
			? '（画像のため中身は比較できません）'
			: change.keys.length > 0
				? `: ${change.keys.join(', ')}`
				: '';
		return `- ${STATUS_LABELS[change.status]} ${displayPath(change.path)}${keys}`;
	});
	return [`スナップショットが ${changes.length} 件変わっています`, ...lines].join('\n');
}

/**
 * セッションへ投入する文。
 * **「直してください」ではなく「説明してください」から始める** — 撮り直しが正しいこともある。
 */
export function buildSnapshotPrompt(
	changes: readonly SnapshotChange[],
	displayPath: (path: string) => string
): string {
	if (changes.length === 0) {
		return '';
	}
	return [
		'スナップショット（ゴールデン）が更新されています。',
		'スナップショットは**通すために更新できてしまう**ので、更新そのものをレビューしたいです。',
		'',
		describeSnapshotChanges(changes, displayPath)
			.split('\n')
			.slice(1)
			.join('\n'),
		'',
		'それぞれについて、**なぜその出力になったのか**を説明してください。',
		'意図した変更でないものは、スナップショットではなく実装の方を直してください。'
	].join('\n');
}
