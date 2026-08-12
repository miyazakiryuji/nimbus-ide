/**
 * セッションをまたいだ「誰が何を触っているか」（tasks.md T-011 / T-012）。
 *
 * 複数のエージェントで同時に同じプロジェクトを開発する、というのが Nimbus の狙いなので、
 * **同じファイルを 2 つのセッションが触る**のは避けられない。避けられない以上、
 * 起きる前に見せる。コンフリクトになってから解くより、書く前に知るほうが安い。
 *
 * `activity.ts` はアクティブな 1 セッションを畳むもので、こちらは**全セッション横断**。
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { filePathOf, READ_TOOLS, WRITE_TOOLS } from './toolInput';

export interface SessionTouch {
	sessionId: string;
	path: string;
	kind: 'read' | 'write';
	at: number;
}

export interface Conflict {
	path: string;
	/** いま書こうとしているセッション */
	sessionId: string;
	/** 同じファイルを既に触っている他のセッション */
	otherSessionIds: string[];
	/** 他のセッションのうち、**書いた**ものがあるか。あるほうが重い */
	otherWrote: boolean;
}

/** 1 セッションの「いま何をしているか」（T-012 の俯瞰に使う） */
export interface SessionSnapshot {
	sessionId: string;
	/** 触ったファイル（新しい順） */
	files: { path: string; kind: 'read' | 'write'; at: number }[];
	lastAt: number;
}

/**
 * 全セッションのイベントから、誰がどのファイルを触ったかを覚えておく係。
 *
 * イベントは流れていくだけなので、通り過ぎる時点で拾うしかない。
 * 覚えるのはファイルを触る呼び出しだけなので軽い。
 */
export class SessionFilesTracker {
	/** sessionId → path → 最後の接触 */
	private readonly touches = new Map<string, Map<string, SessionTouch>>();

	record(event: NimbusEvent): void {
		if (event.kind !== 'tool-use') {
			return;
		}
		const isRead = READ_TOOLS.has(event.toolName);
		const isWrite = WRITE_TOOLS.has(event.toolName);
		if (!isRead && !isWrite) {
			return;
		}
		const path = filePathOf(event.input);
		if (!path) {
			return;
		}
		const perSession = this.touches.get(event.sessionId) ?? new Map<string, SessionTouch>();
		const previous = perSession.get(path);
		// 一度でも書いていれば「書いた」を保つ（読みで上書きしない）
		const kind: 'read' | 'write' = isWrite || previous?.kind === 'write' ? 'write' : 'read';
		perSession.set(path, { sessionId: event.sessionId, path, kind, at: event.timestamp });
		this.touches.set(event.sessionId, perSession);
	}

	/** セッションを閉じたら忘れる（終わったセッションと衝突しても意味がない） */
	forget(sessionId: string): void {
		this.touches.delete(sessionId);
	}

	/**
	 * このセッションがこのファイルを書こうとしたとき、他に触っているセッションがあるか（T-011）。
	 * **読みだけの衝突も返す**（読んだ内容が古くなるのも事故のうち）が、
	 * 相手が書いているかどうかは区別して返す。
	 */
	conflictFor(sessionId: string, path: string): Conflict | undefined {
		const others: string[] = [];
		let otherWrote = false;
		for (const [otherId, perSession] of this.touches) {
			if (otherId === sessionId) {
				continue;
			}
			const touch = perSession.get(path);
			if (!touch) {
				continue;
			}
			others.push(otherId);
			otherWrote ||= touch.kind === 'write';
		}
		return others.length > 0 ? { path, sessionId, otherSessionIds: others, otherWrote } : undefined;
	}

	/** 全セッションの俯瞰（T-012）。最後に動いたのが新しい順 */
	snapshots(): SessionSnapshot[] {
		const snapshots: SessionSnapshot[] = [];
		for (const [sessionId, perSession] of this.touches) {
			const files = [...perSession.values()]
				.sort((a, b) => b.at - a.at)
				.map((touch) => ({ path: touch.path, kind: touch.kind, at: touch.at }));
			snapshots.push({ sessionId, files, lastAt: files[0]?.at ?? 0 });
		}
		return snapshots.sort((a, b) => b.lastAt - a.lastAt);
	}
}

/** 衝突を 1 行で伝える。相手が書いているかどうかで言い方を変える */
export function describeSessionConflict(conflict: Conflict, nameOf: (sessionId: string) => string): string {
	const others = conflict.otherSessionIds.map(nameOf).join(' / ');
	const file = conflict.path.split('/').pop() ?? conflict.path;
	return conflict.otherWrote
		? `${file} は ${others} も編集しています。競合します`
		: `${file} は ${others} も読んでいます。書き換えると相手の前提が古くなります`;
}
