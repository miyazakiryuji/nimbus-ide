/**
 * 証跡つき完了報告（tasks.md T-081）の書き出し。
 *
 * 「できました」だけの報告を無くす。何を変えたのか、テストを走らせたのか、
 * 通ったのかを 1 枚にまとめて開く。**通っていないなら、そう書く。**
 */
import * as vscode from 'vscode';
import type { NimbusEvent } from './events';
import { collectEvidence, describeEvidence, isBackedByTests, type Evidence } from './core/evidence';

function outcomeMark(outcome: 'passed' | 'failed' | 'unknown'): string {
	switch (outcome) {
		case 'passed':
			return '✅ 成功';
		case 'failed':
			return '❌ 失敗';
		default:
			return '⚠️ 判定できず';
	}
}

/** 出力は長いので畳む。判断のもとになった箇所が見えれば足りる */
function trimOutput(output: string, limit: number = 800): string {
	const trimmed = output.trim();
	return trimmed.length > limit ? `${trimmed.slice(0, limit)}\n…（以下略）` : trimmed;
}

export function buildReport(evidence: Evidence, now: Date): string {
	const lines: string[] = [];
	lines.push('# 完了報告', '');
	lines.push(`- 作成: ${now.toLocaleString('ja-JP')}`);
	lines.push(`- 証跡: ${describeEvidence(evidence)}`);
	lines.push(
		isBackedByTests(evidence)
			? '- 判定: **テストで裏づけられています**'
			: '- 判定: **まだ「完了」とは言えません**（テストが通ったことを確認できていません）'
	);
	lines.push('');

	lines.push('## 変えたもの', '');
	if (evidence.attributions.length === 0) {
		lines.push('（ファイルの変更はありません）', '');
	} else {
		for (const attribution of evidence.attributions) {
			lines.push(`### ${attribution.prompt.replace(/\s+/g, ' ').trim()}`, '');
			for (const edit of attribution.edits) {
				lines.push(`- \`${edit.path}\`（${edit.toolName}）`);
			}
			if (attribution.reads.length > 0) {
				lines.push(`- 読んだもの: ${attribution.reads.map((path) => `\`${path}\``).join(' / ')}`);
			}
			lines.push('');
		}
	}

	lines.push('## テストの実行', '');
	if (evidence.runs.length === 0) {
		// ここを空欄にしない。走らせていないことも証跡のうち
		lines.push('**テストを実行していません。**', '');
	} else {
		for (const run of evidence.runs) {
			lines.push(`### ${outcomeMark(run.outcome)} \`${run.command}\``, '');
			lines.push('```', trimOutput(run.output), '```', '');
		}
	}

	return lines.join('\n');
}

/** 報告を作って開く。開くところまでやらないと、結局コピーされない */
export async function openCompletionReport(events: readonly NimbusEvent[]): Promise<void> {
	const evidence = collectEvidence(events);
	const document = await vscode.workspace.openTextDocument({
		content: buildReport(evidence, new Date()),
		language: 'markdown'
	});
	await vscode.window.showTextDocument(document, { preview: false });
	if (!isBackedByTests(evidence)) {
		void vscode.window.showWarningMessage(`Nimbus: ${describeEvidence(evidence)}。「完了」と言う前に確認してください。`);
	}
}
