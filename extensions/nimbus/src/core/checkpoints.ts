/**
 * チェックポイント（tasks.md T-025）。
 *
 * CLI では Esc 2 回で 1 つ前へ戻る。それだと「どこまで戻るのか」が押すまで分からず、
 * 戻しすぎても気づけない。**戻す先を選んでから戻す**形にするための材料を作る。
 *
 * 巻き戻しの実体は SDK の `Query.rewindFiles(userMessageId)`。
 * ここはイベント列から候補を組み立て、結果を言葉にするだけ（VS Code 非依存）。
 */
import type { NimbusEvent } from '../events';

export interface Checkpoint {
	/** `rewindFiles()` に渡す UUID */
	messageUuid: string;
	/** そのとき何を頼んだか（選ぶときの手がかりはこれしかない） */
	text: string;
	at: number;
	/** 古いほうから 1, 2, 3…。「3 つ前に戻す」と言えるようにするための番号 */
	index: number;
}

/** 巻き戻しの結果。SDK の `RewindFilesResult` と構造互換 */
export interface RewindOutcome {
	canRewind: boolean;
	error?: string;
	filesChanged?: string[];
	insertions?: number;
	deletions?: number;
}

const LABEL_LIMIT = 60;

/** 一覧に出す 1 行。長い指示は畳む（選ぶのに要るのは頭だけ） */
export function checkpointLabel(checkpoint: Checkpoint): string {
	const flat = checkpoint.text.replace(/\s+/g, ' ').trim();
	return flat.length > LABEL_LIMIT ? `${flat.slice(0, LABEL_LIMIT)}…` : flat;
}

/**
 * イベント列から巻き戻し候補を組み立てる。**新しい順**に返す
 * （戻したいのはたいてい直近なので、選ぶ手間が少ないほうを上に置く）。
 */
export function buildCheckpoints(events: readonly NimbusEvent[]): Checkpoint[] {
	const seen = new Set<string>();
	const ordered: Checkpoint[] = [];
	for (const event of events) {
		if (event.kind !== 'checkpoint' || seen.has(event.messageUuid)) {
			continue;
		}
		seen.add(event.messageUuid);
		ordered.push({
			messageUuid: event.messageUuid,
			text: event.text,
			at: event.timestamp,
			index: ordered.length + 1
		});
	}
	return ordered.reverse();
}


/** 画面に出ている利用者の発言 1 つと、それに対応する巻き戻し先（T-363） */
export interface UserTurn {
	/** 画面の `.turn.user` の並び順（0 始まり）。webview から来る鍵はこれ */
	turnIndex: number;
	/** 利用者が書いた本文。編集欄へ戻すのはこれ */
	text: string;
	/** `rewindFiles()` に渡す UUID。**無いこともある**（戻り先が残っていない発言） */
	messageUuid?: string;
}

/**
 * 画面の発言と、巻き戻し先を**明示的に結ぶ**（T-363）。
 *
 * **本文や時刻で突き合わせてはいけない。** 表示用の `user-text` と SDK 由来の `checkpoint` は
 * 別のイベントで、同じ文を 2 回送ると本文では見分けが付かない（Codex の指摘 2026-08-31）。
 * ここでは**同じ列の並び順**で結ぶ — ある `user-text` の直後に来た最初の `checkpoint` が、
 * その発言の戻り先。SDK は次の発言を受ける前にその発言のチェックポイントを出すので、
 * この対応は列の上で一意に決まる。
 *
 * 結び先が見つからない発言（合成メッセージ・コンパクションより前・まだ処理されていない）は
 * `messageUuid` を持たない。**鉛筆を隠すだけでなく、理由を言えるようにする**ため、
 * 落とさずに返す。
 */
export function pairUserTurns(events: readonly NimbusEvent[]): UserTurn[] {
	const turns: UserTurn[] = [];
	for (const event of events) {
		if (event.kind === 'user-text') {
			turns.push({ turnIndex: turns.length, text: event.text });
			continue;
		}
		if (event.kind !== 'checkpoint') {
			continue;
		}
		// 直近の発言にだけ結ぶ。既に結んであるものへ上書きしない
		// （同じ発言に 2 つ目のチェックポイントが来ても、最初のものが戻り先）
		const last = turns[turns.length - 1];
		if (last && last.messageUuid === undefined) {
			last.messageUuid = event.messageUuid;
		}
	}
	return turns;
}

/**
 * 巻き戻しの結果を 1 行にする。
 * **何も変わらないこと**もはっきり言う（「戻したつもりで戻っていない」が一番困る）。
 */
export function describeRewind(outcome: RewindOutcome): string {
	if (!outcome.canRewind) {
		return outcome.error ? `巻き戻せません: ${outcome.error}` : '巻き戻せません';
	}
	const files = outcome.filesChanged?.length ?? 0;
	if (files === 0) {
		/*
		 * **「会話だけが戻ります」とは言わない**（T-364・2026-08-31 に訂正）。
		 * 巻き戻しの実体は SDK の `rewindFiles()` で、戻すのは**ファイルだけ**。
		 * 会話を切り詰める処理は Nimbus のどこにも無い。
		 * 「戻したつもりで戻っていない」を防ぐために書いた一文が、それ自体で嘘をついていた。
		 * 会話の巻き戻しは T-363（送信済みプロンプトの編集）で作る。
		 */
		return '戻せるファイルの変更はありません（会話はそのまま残ります）';
	}
	const insertions = outcome.insertions ?? 0;
	const deletions = outcome.deletions ?? 0;
	return `${files} ファイル · +${insertions} / -${deletions}`;
}
