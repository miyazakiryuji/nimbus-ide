/**
 * ローカル完結・集中モード・詰まったときの立て直し
 * （tasks.md T-077 / T-087 / T-088）。
 *
 * 3 つとも「**外へ出す／中に留める**」の判断で、判断を誤ると実害が出る。
 * ローカル完結は情報を、集中モードは通知を、リカバリは作業そのものを扱う。
 *
 * VS Code に依存しないので単体で検証できる。
 */

/**
 * ローカル完結モード（T-077）で止めるもの。
 *
 * **Claude 本体との通信は止められない**（それを止めるとエージェントが動かない）。
 * 止められるのは Nimbus が自分で外へ出しているものだけなので、
 * **何が止まって何が止まらないかを、はっきり言う**。
 */
export interface LocalOnlyEffect {
	/** 止まるもの */
	stopped: string[];
	/** 止まらないもの（誤解させないために必ず出す） */
	notStopped: string[];
}

export function localOnlyEffect(): LocalOnlyEffect {
	return {
		stopped: [
			'監査ログの書き出し（T-050）',
			'ホットリロードのコマンド実行（T-072）',
			'フックのドライラン（T-161）',
			'OS 通知（T-019・本文が外部プロセスへ渡るため）'
		],
		notStopped: [
			'Claude 本体との通信（これを止めるとエージェントが動きません）',
			'MCP サーバーへの接続（設定した先へは繋がります）',
			'Bash などツールの実行（`nimbus.policy.profile` の「隔離」で塞げます）'
		]
	};
}

/** 集中モード（T-087）で、通知を出してよいか */
export interface NotificationDecision {
	notify: boolean;
	reason: 'focus-mode' | 'disabled' | 'window-focused' | 'ok';
}

/**
 * 通知を出すかを決める（T-019 と T-087 の折り合い）。
 *
 * タスクには「T-019 の完了通知と方針が衝突するので、どちらを既定にするかを決める」とある。
 * **決めた: 集中モードが優先。** ただし**承認待ちだけは通す** —
 * 承認待ちは「止まっている」ことの通知で、黙らせると作業が進まなくなる。
 * 集中モードが黙らせたいのは「終わった」の知らせであって、「止まっている」ではない。
 */
export function shouldNotify(options: {
	enabled: boolean;
	focusMode: boolean;
	onlyWhenUnfocused: boolean;
	windowFocused: boolean;
	/** 承認待ちの通知か */
	isApproval: boolean;
}): NotificationDecision {
	if (!options.enabled) {
		return { notify: false, reason: 'disabled' };
	}
	if (options.focusMode && !options.isApproval) {
		return { notify: false, reason: 'focus-mode' };
	}
	if (options.onlyWhenUnfocused && options.windowFocused) {
		return { notify: false, reason: 'window-focused' };
	}
	return { notify: true, reason: 'ok' };
}

/** 詰まっている、と言える状態か（T-088） */
export interface StuckSignals {
	/** 直近のターンで失敗したツールの数 */
	recentToolErrors: number;
	/** 同じファイルを続けて編集した回数 */
	repeatedEditsOnSameFile: number;
	/** 直近のテストが落ちているか */
	testsFailing: boolean;
}

export type RecoveryOption = 'rewind' | 'alternative' | 'handover' | 'continue';

export interface RecoverySuggestion {
	stuck: boolean;
	/** なぜそう見えるか。**理由を言わずに提案しない** */
	reason?: string;
	options: RecoveryOption[];
}

export const RECOVERY_LABEL: Record<RecoveryOption, string> = {
	rewind: '一旦戻す（チェックポイントへ）',
	alternative: '別解を試す（方針を比べる）',
	handover: '人間が手を入れる（私が書く番にする）',
	continue: 'このまま続ける'
};

/** 詰まりの目安。これ以上は「様子を見る」より「手を変える」ほうが早い */
const ERROR_THRESHOLD = 3;
const REPEAT_THRESHOLD = 4;

/**
 * 立て直しを提案すべきか（T-088）。
 *
 * **勝手に戻さない。** 提案するだけで、選ぶのは利用者。
 * 詰まりの判定は当て推量なので、**理由を必ず添える**（外れていると分かれば無視できる）。
 */
export function suggestRecovery(signals: StuckSignals): RecoverySuggestion {
	const reasons: string[] = [];
	if (signals.recentToolErrors >= ERROR_THRESHOLD) {
		reasons.push(`ツールの失敗が ${signals.recentToolErrors} 回続いています`);
	}
	if (signals.repeatedEditsOnSameFile >= REPEAT_THRESHOLD) {
		reasons.push(`同じファイルを ${signals.repeatedEditsOnSameFile} 回続けて直しています`);
	}
	if (signals.testsFailing) {
		reasons.push('直近のテストが通っていません');
	}
	if (reasons.length === 0) {
		return { stuck: false, options: [] };
	}
	return {
		stuck: true,
		reason: reasons.join(' / '),
		// 「このまま続ける」を必ず最後に置く。提案が邪魔なときに逃げ道が要る
		options: ['rewind', 'alternative', 'handover', 'continue']
	};
}
