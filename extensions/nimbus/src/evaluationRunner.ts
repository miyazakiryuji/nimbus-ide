/**
 * 回帰テスト・ブレ幅・モデル比較を実際に走らせる（tasks.md T-165 / T-166 / T-167）。
 *
 * **本物のセッションを使うので費用がかかる。** 走らせる前に必ず回数と見込みを見せて、
 * 承認を取ってから始める。黙って 15 回まわすようなことはしない。
 */
import { randomUUID } from 'crypto';
import * as vscode from 'vscode';
import type { NimbusEvent } from './events';
import type { SessionManager } from './session/SessionManager';
import {
	cheapestPassing,
	compareModels,
	describeStability,
	judge,
	measureStability,
	type EvalCase,
	type JudgedRun
} from './core/evaluation';

/** 1 回あたりの待ち上限。返らないセッションで全体を止めない */
const RUN_TIMEOUT_MS = 180_000;

/** 1 回走らせて、応答と実測を集める */
async function runOnce(
	sessions: SessionManager,
	cwd: string,
	testCase: EvalCase,
	attempt: number,
	model: string | undefined
): Promise<JudgedRun> {
	const sessionId = randomUUID();
	const started = Date.now();
	let text = '';
	let costUsd: number | undefined;

	const done = new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, RUN_TIMEOUT_MS);
		const onEvent = (event: NimbusEvent): void => {
			if (event.sessionId !== sessionId) {
				return;
			}
			if (event.kind === 'assistant-text') {
				text += `${event.text}\n`;
			} else if (event.kind === 'turn-result') {
				costUsd = event.totalCostUsd;
				clearTimeout(timer);
				sessions.off('event', onEvent);
				resolve();
			} else if (event.kind === 'session-error') {
				clearTimeout(timer);
				sessions.off('event', onEvent);
				resolve();
			}
		};
		sessions.on('event', onEvent);
	});

	await sessions.createSession({
		cwd,
		firstMessage: testCase.prompt,
		reuseSessionId: sessionId,
		extraOptions: {
			...(model ? { model } : {}),
			// 評価中に書き換えさせない。比べたいのは応答であって、副作用ではない
			permissionMode: 'plan'
		}
	});
	await done;
	try {
		sessions.close(sessionId);
	} catch {
		// すでに閉じている
	}
	return judge(testCase, { attempt, text: text.trim(), durationMs: Date.now() - started, costUsd, model });
}

export interface EvaluationRequest {
	testCase: EvalCase;
	/** 何回まわすか（ブレ幅を見るため） */
	attempts: number;
	/** 比べるモデル。空なら既定のモデルだけ */
	models: string[];
}

/**
 * 走らせて、結果を Markdown で開く。
 * **走らせる前に必ず確認を取る** — 本物のセッションを使うので費用がかかる。
 */
export async function runEvaluation(
	sessions: SessionManager,
	cwd: string,
	request: EvaluationRequest,
	log: (message: string) => void
): Promise<void> {
	const models = request.models.length > 0 ? request.models : [undefined as unknown as string];
	const total = request.attempts * models.length;
	const CONFIRM = '走らせる';
	const answer = await vscode.window.showWarningMessage(
		`Nimbus: セッションを ${total} 回まわします。`,
		{
			modal: true,
			detail:
				'本物のセッションを使うので費用がかかります。'
				+ '\n評価中は plan モードで走らせるので、ファイルは書き換えません。'
		},
		CONFIRM
	);
	if (answer !== CONFIRM) {
		return;
	}

	const runs = await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: `Nimbus: ${request.testCase.name} を評価しています`, cancellable: true },
		async (progress, token) => {
			const collected: JudgedRun[] = [];
			for (const model of models) {
				for (let attempt = 1; attempt <= request.attempts; attempt++) {
					if (token.isCancellationRequested) {
						return collected;
					}
					progress.report({ message: `${collected.length + 1} / ${total}${model ? `（${model}）` : ''}` });
					collected.push(await runOnce(sessions, cwd, request.testCase, attempt, model));
				}
			}
			return collected;
		}
	);

	if (runs.length === 0) {
		void vscode.window.showInformationMessage('Nimbus: 1 回も走りませんでした。');
		return;
	}

	const stability = measureStability(runs);
	const comparisons = compareModels(runs);
	const cheapest = cheapestPassing(comparisons);
	log(`[eval] ${request.testCase.name}: ${describeStability(stability)}`);

	const lines: string[] = [
		`# 評価: ${request.testCase.name}`,
		'',
		`- 結果: **${describeStability(stability)}**`,
		`- 期待した語: ${request.testCase.expect.map((word) => `\`${word}\``).join(' / ')}`,
		''
	];
	if (comparisons.length > 1) {
		lines.push('## モデル別', '', '| モデル | 合格 | 振れ | 所要（中央値） | 費用 |', '| --- | --- | --- | --- | --- |');
		for (const comparison of comparisons) {
			lines.push(
				`| ${comparison.model} | ${comparison.stability.passed}/${comparison.stability.attempts} | `
				+ `${comparison.stability.lengthVariation}% | ${Math.round(comparison.medianDurationMs / 1000)} 秒 | `
				+ `$${comparison.totalCostUsd.toFixed(4)} |`
			);
		}
		lines.push('');
		lines.push(
			cheapest
				? `**通ったなかで一番安いのは ${cheapest.model}**（$${cheapest.totalCostUsd.toFixed(4)}）。`
				: '**すべて落ちました。** 軽いモデルを勧められる状態ではありません。',
			''
		);
	}
	lines.push('## 各回', '');
	for (const item of runs) {
		lines.push(
			`### ${item.verdict === 'passed' ? '✅' : '❌'} ${item.attempt} 回目${item.model ? `（${item.model}）` : ''}`,
			'',
			item.reason ? `落ちた理由: ${item.reason}` : '',
			'',
			'```',
			item.text.slice(0, 1200) || '（応答なし）',
			'```',
			''
		);
	}
	const document = await vscode.workspace.openTextDocument({
		content: lines.filter((line) => line !== undefined).join('\n'),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
}
