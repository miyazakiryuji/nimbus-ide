/**
 * 走っている最中に「また同じことを言っている」に気づく（tasks.md T-237）。
 *
 * 繰り返しの検出は過去の記録から作れる（`core/repeatedInstructions.ts`）が、
 * **読み返すのは後日**になる。同じ指示を 3 回目に書いている**その場**で気づけないと、
 * CLAUDE.md に書き足す機会は永久に来ない。
 *
 * 判定は既存の純関数をそのまま使う。ここは「いつ聞くか」だけを持つ。
 */
import * as vscode from 'vscode';
import { findRepeatedInstructions } from './core/repeatedInstructions';

export interface SessionRepeatsDeps {
	/** CLAUDE.md へ足す導線（既存のコマンドに繋ぐ） */
	promote: (text: string) => Promise<void>;
	log: (message: string) => void;
}

export class SessionRepeats {
	/** このセッションで送った指示 */
	private readonly instructions: string[] = [];
	/** 一度勧めたものは、同じセッションで二度言わない */
	private readonly suggested = new Set<string>();

	constructor(private readonly deps: SessionRepeatsDeps) { }

	/** 新しいセッションが始まったら数え直す */
	reset(): void {
		this.instructions.length = 0;
		this.suggested.clear();
	}

	/** 指示を送るたびに呼ぶ */
	record(text: string): void {
		if (vscode.workspace.getConfiguration('nimbus').get<boolean>('claudeMd.suggestRepeats') === false) {
			return;
		}
		this.instructions.push(text);
		const repeated = findRepeatedInstructions(this.instructions).find(
			(entry) => !this.suggested.has(entry.text)
		);
		if (!repeated) {
			return;
		}
		this.suggested.add(repeated.text);
		this.deps.log(`[repeat] ${repeated.count} 回目: ${repeated.text}`);

		const ADD = 'CLAUDE.md に足す';
		void vscode.window
			.showInformationMessage(
				`Nimbus: 同じ指示を ${repeated.count} 回書いています。CLAUDE.md に足しますか？`,
				{ detail: repeated.text, modal: false },
				ADD
			)
			.then((choice) => {
				if (choice === ADD) {
					void this.deps.promote(repeated.text);
				}
			});
	}
}
