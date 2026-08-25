/**
 * 1 往復だけの問い合わせ（tasks.md T-305 の裏方）。
 *
 * コミットメッセージの生成のような「答えを 1 つもらったら終わり」の用途で、
 * **会話の面に出さない使い捨てセッション**を回す。評価（`evaluationRunner.ts`）と同じ形。
 *
 * - `permissionMode: 'plan'` で走らせる — 材料は指示文に全部入れて渡すので、
 *   ツールは要らないし、副作用を起こさせない
 * - 終わったら必ず閉じる。タブにも一覧にも出さない（`SessionManager` は未登録の面を持たない）
 */
import { randomUUID } from 'crypto';
import type { NimbusEvent } from './events';
import type { SessionManager } from './session/SessionManager';

export interface OneShotResult {
	text: string;
	costUsd?: number;
}

/** いま走っている使い捨てセッション。タブや状態の帯に**出さない**ための名簿 */
const activeOneShots = new Set<string>();

/** このセッションは使い捨て（画面に出さない）か */
export function isOneShotSession(sessionId: string): boolean {
	return activeOneShots.has(sessionId);
}

export async function oneShot(
	sessions: SessionManager,
	options: { cwd: string; prompt: string; model?: string; timeoutMs?: number }
): Promise<OneShotResult> {
	const sessionId = randomUUID();
	activeOneShots.add(sessionId);
	let text = '';
	let costUsd: number | undefined;

	const done = new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, options.timeoutMs ?? 120_000);
		const onEvent = (event: NimbusEvent): void => {
			if (event.sessionId !== sessionId) {
				return;
			}
			if (event.kind === 'assistant-text') {
				text += `${event.text}\n`;
			} else if (event.kind === 'turn-result' || event.kind === 'session-error') {
				if (event.kind === 'turn-result') {
					costUsd = event.totalCostUsd;
				}
				clearTimeout(timer);
				sessions.off('event', onEvent);
				resolve();
			}
		};
		sessions.on('event', onEvent);
	});

	await sessions.createSession({
		cwd: options.cwd,
		firstMessage: options.prompt,
		reuseSessionId: sessionId,
		extraOptions: {
			...(options.model ? { model: options.model } : {}),
			// 答えをもらうだけ。書き換えさせない
			permissionMode: 'plan'
		}
	});
	await done;
	try {
		sessions.close(sessionId);
	} catch {
		// すでに閉じている
	} finally {
		activeOneShots.delete(sessionId);
	}
	return { text: text.trim(), costUsd };
}
