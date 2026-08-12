/**
 * レビューを頼む文を組み立てる（tasks.md T-211）。
 *
 * 「見てください」だけ送られても、受け取った側は**どこから読めばいいか分からない**。
 * かといって書く側も、毎回同じ説明を書くのは面倒で、結局「見てください」になる。
 *
 * PR の説明（[pr-description](pr-description.md)）は残す文書、こちらは**送る文**。
 * 短く、相手が最初にやることが分かる形にする。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { ChangeStats } from './changeStats';

export interface ReviewRequestInput {
	branch: string;
	base: string;
	stats: ChangeStats;
	/** 変更の意図（人が書く。無ければ空欄のまま出す） */
	intent?: string;
	/** 見てほしい観点 */
	focus?: string;
	/** PR の URL（分かるときだけ） */
	url?: string;
}

/** どこから読めばいいか。**大きい順ではなく、テスト → 実装の順**にする */
export function readingOrder(stats: ChangeStats, limit = 5): string[] {
	const tests = stats.files.filter((file) => file.isTest);
	const rest = stats.files.filter((file) => !file.isTest);
	// テストを先に読むと「何を期待しているか」が分かるので、実装が速く読める
	return [...tests, ...rest].slice(0, limit).map((file) => file.path);
}

export function renderReviewRequest({ branch, base, stats, intent, focus, url }: ReviewRequestInput): string {
	const lines: string[] = [];

	lines.push(intent?.trim() ? intent.trim() : '（何のための変更かを 1 行で書いてください）');
	lines.push('');
	lines.push(`\`${branch}\` → \`${base}\`／${stats.files.length} ファイル（+${stats.added} / -${stats.removed}）`);
	if (url) {
		lines.push(url);
	}
	lines.push('');

	const order = readingOrder(stats);
	if (order.length > 0) {
		lines.push('読む順のおすすめ:');
		for (const path of order) {
			lines.push(`- \`${path}\``);
		}
		lines.push('');
	}

	if (focus?.trim()) {
		lines.push(`とくに見てほしいところ: ${focus.trim()}`);
		lines.push('');
	}

	// 相手が最初に判断できる材料を、必ず 1 行入れる
	lines.push(
		stats.noTestChanges
			? '※ テストは変えていません。書けない事情があるので、そこも含めて見てもらえると助かります。'
			: 'テストも一緒に変えてあります。'
	);

	return lines.join('\n');
}
