/**
 * 送れなかった入力を預かる（tasks.md T-151）。
 *
 * 席を外している間に回線が切れていた、というだけで**打った文が消える**のが一番困る。
 * 送れなかったものは捨てずに預かり、送れるようになったら順に出す。
 *
 * 「繋がったら送る」を機械が勝手にやると、**意図しない時点で走り出す**ので、
 * ここは預かるところまで。出すかどうかは呼び出し側が決める。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export interface QueuedInput {
	text: string;
	at: number;
	/** 送れなかった理由（利用者に見せる） */
	reason: string;
}

/** 預かる上限。溜まりすぎたものを後からまとめて送っても、たいてい役に立たない */
export const MAX_QUEUED = 20;

/**
 * 送れなかった入力を預かる箱。
 * 古いものから落とすのは、**新しい指示のほうが今の状況に合っている**ため。
 */
export class Outbox {
	private items: QueuedInput[] = [];

	add(text: string, reason: string, at: number): void {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		this.items.push({ text: trimmed, reason, at });
		if (this.items.length > MAX_QUEUED) {
			this.items = this.items.slice(-MAX_QUEUED);
		}
	}

	list(): readonly QueuedInput[] {
		return [...this.items];
	}

	get size(): number {
		return this.items.length;
	}

	/** 預かっているものを全部取り出して空にする（出すのは呼び出し側の判断） */
	drain(): QueuedInput[] {
		const items = this.items;
		this.items = [];
		return items;
	}

	clear(): void {
		this.items = [];
	}
}

/**
 * 送信の失敗が「一時的なもの（＝預かる意味がある）」かどうか。
 *
 * 書き方の誤りや権限の問題は、預かって送り直しても同じように失敗する。
 * **繋がらない類のものだけ**を預かる。
 */
export function isTransientFailure(message: string): boolean {
	return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETDOWN|ENETUNREACH|socket hang up|network|offline|fetch failed|timed? ?out/i.test(
		message
	);
}

/** 預かっているものを 1 行で伝える */
export function describeOutbox(outbox: Outbox): string {
	const size = outbox.size;
	return size === 0 ? '' : `送れていない入力が ${size} 件あります`;
}
