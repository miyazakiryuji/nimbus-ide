/**
 * 計測結果を読んで、重いところを出す（tasks.md T-128）。
 *
 * プロファイラの画面は**情報が多すぎて**、どこを直せばいいのかが分からない。
 * 開いた人がまず見るのは炎のグラフだが、そこに出ているのはたいてい
 * ランタイムの内部（`node:internal/...`）で、直せる場所ではない。
 *
 * ここでやるのは 2 つだけ:
 *   - **自分のコード**と**それ以外**を分ける（直せるものだけを上に出す）
 *   - 直させる前に、**測り直す手順**を書く（速くなったかは、測らないと分からない）
 *
 * Chrome DevTools と `node --cpu-prof` の `.cpuprofile` を読む。
 *
 * VS Code に依存しないので単体で検証できる。
 */

export type Origin = 'own' | 'dependency' | 'runtime' | 'engine';

export interface HotSpot {
	name: string;
	file?: string;
	line?: number;
	/** その関数自身が使った時間（呼び出し先は含まない） */
	selfMs: number;
	origin: Origin;
}

export interface ProfileSummary {
	hotSpots: HotSpot[];
	/** 計測していた時間 */
	totalMs: number;
	/** 何もしていなかった時間 */
	idleMs: number;
}

interface ProfileNode {
	id: number;
	callFrame: { functionName: string; url: string; lineNumber: number };
	children?: number[];
}

/**
 * どこのコードか。
 *
 * **`node_modules` を「自分のコード」に混ぜない。** そこが重いと分かっても、
 * できるのは「呼ぶ回数を減らす」か「別のものに替える」であって、直しに行く場所が違う。
 */
export function classifyOrigin(url: string): Origin {
	if (url.length === 0) {
		return 'engine';
	}
	if (url.startsWith('node:') || url.startsWith('internal/')) {
		return 'runtime';
	}
	if (url.includes('node_modules')) {
		return 'dependency';
	}
	return 'own';
}

/** V8 が入れる、関数ではないもの */
const SYNTHETIC = new Set(['(root)', '(program)', '(idle)', '(garbage collector)']);

/**
 * `.cpuprofile` を読む。
 *
 * **自己時間は `samples` と `timeDeltas` から出す。** `hitCount` は回数でしかなく、
 * 1 回あたりの長さは一定ではない。実測すると `timeDeltas` の合計は
 * `endTime - startTime` にぴったり一致するので、こちらが正確。
 */
export function parseProfile(json: string): ProfileSummary {
	let profile: {
		nodes?: ProfileNode[];
		samples?: number[];
		timeDeltas?: number[];
		startTime?: number;
		endTime?: number;
	};
	try {
		profile = JSON.parse(json);
	} catch {
		return { hotSpots: [], totalMs: 0, idleMs: 0 };
	}

	const nodes = profile.nodes ?? [];
	const samples = profile.samples ?? [];
	const timeDeltas = profile.timeDeltas ?? [];
	if (nodes.length === 0 || samples.length === 0) {
		return { hotSpots: [], totalMs: 0, idleMs: 0 };
	}

	const byId = new Map(nodes.map((node) => [node.id, node]));
	const selfByNode = new Map<number, number>();
	for (let i = 0; i < samples.length; i++) {
		// timeDeltas[i] は「1 つ前のサンプルからの経過」。samples[i] に付ける
		const delta = timeDeltas[i] ?? 0;
		selfByNode.set(samples[i], (selfByNode.get(samples[i]) ?? 0) + delta);
	}

	// 同じ関数が複数のノードに分かれる（呼び出し経路ごとに 1 ノード）ので、まとめる
	const merged = new Map<string, HotSpot>();
	let idleMicros = 0;

	for (const [nodeId, micros] of selfByNode) {
		const node = byId.get(nodeId);
		if (!node) {
			continue;
		}
		const { functionName, url, lineNumber } = node.callFrame;
		if (functionName === '(idle)') {
			idleMicros += micros;
			continue;
		}
		if (SYNTHETIC.has(functionName)) {
			continue;
		}
		const key = `${functionName}|${url}|${lineNumber}`;
		const existing = merged.get(key);
		if (existing) {
			existing.selfMs += micros / 1000;
			continue;
		}
		merged.set(key, {
			// 無名関数は場所でしか呼べない
			name: functionName.length > 0 ? functionName : '(無名)',
			file: url.length > 0 ? url : undefined,
			line: lineNumber >= 0 ? lineNumber + 1 : undefined,
			selfMs: micros / 1000,
			origin: classifyOrigin(url)
		});
	}

	const totalMicros =
		profile.startTime !== undefined && profile.endTime !== undefined
			? profile.endTime - profile.startTime
			: timeDeltas.reduce((sum, delta) => sum + delta, 0);

	return {
		hotSpots: [...merged.values()].sort((a, b) => b.selfMs - a.selfMs),
		totalMs: totalMicros / 1000,
		idleMs: idleMicros / 1000
	};
}

/** 直しに行ける場所だけ */
export function ownCode(hotSpots: readonly HotSpot[]): HotSpot[] {
	return hotSpots.filter((spot) => spot.origin === 'own');
}

function shortFile(spot: HotSpot): string {
	if (!spot.file) {
		return '';
	}
	const path = spot.file.replace(/^file:\/\//, '');
	const short = path.split('/').slice(-2).join('/');
	return spot.line === undefined ? ` \`${short}\`` : ` \`${short}:${spot.line}\``;
}

function row(spot: HotSpot, totalMs: number): string {
	const share = totalMs > 0 ? Math.round((spot.selfMs / totalMs) * 100) : 0;
	return `- **${spot.name}** — ${spot.selfMs.toFixed(1)} ms（${share}%）${shortFile(spot)}`;
}

export function renderProfile(summary: ProfileSummary, limit = 10): string {
	if (summary.hotSpots.length === 0) {
		return [
			'# 計測結果',
			'',
			'読み取れませんでした。`.cpuprofile`（Chrome DevTools か `node --cpu-prof`）を選んでください。',
			''
		].join('\n');
	}

	const own = ownCode(summary.hotSpots);
	const others = summary.hotSpots.filter((spot) => spot.origin !== 'own');
	const lines = [
		'# 計測結果',
		'',
		`計測していたのは ${summary.totalMs.toFixed(0)} ms。うち ${summary.idleMs.toFixed(0)} ms は待っていた時間です。`,
		''
	];

	lines.push('## 直しに行ける場所', '');
	if (own.length === 0) {
		lines.push(
			'**自分のコードには、目立つ時間が出ていません。**',
			'重いのはランタイムか依存の中です。呼ぶ回数を減らせないかを先に考えてください。',
			''
		);
	} else {
		lines.push(...own.slice(0, limit).map((spot) => row(spot, summary.totalMs)), '');
	}

	if (others.length > 0) {
		lines.push('## その中で呼ばれているもの（直接は直せない）', '');
		lines.push(...others.slice(0, 5).map((spot) => row(spot, summary.totalMs)), '');
	}

	lines.push(
		'**この数字は 1 回の計測です。** 速くなったかどうかは、直したあとに同じ手順で',
		'測り直して比べてください（1 回の差は誤差に埋もれます）。',
		''
	);
	return lines.join('\n');
}

/** そのまま渡せる形。**直させる前に、測り直す手順を書かせる** */
export function buildProfilePrompt(summary: ProfileSummary, limit = 5): string {
	const own = ownCode(summary.hotSpots).slice(0, limit);
	if (own.length === 0) {
		return [
			'CPU プロファイルを取りましたが、自分のコードに目立つ時間は出ていませんでした。',
			`計測 ${summary.totalMs.toFixed(0)} ms、うち待ち時間 ${summary.idleMs.toFixed(0)} ms。`,
			'',
			'重いのはランタイムか依存の中です。**呼ぶ回数を減らせないか**を先に見てください。'
		].join('\n');
	}

	return [
		`CPU プロファイルの結果です（計測 ${summary.totalMs.toFixed(0)} ms）。自分のコードで時間を使っている順:`,
		'',
		...own.map((spot, index) => `${index + 1}. ${spot.name}${shortFile(spot)} — ${spot.selfMs.toFixed(1)} ms`),
		'',
		'**まだ直さないでください。** 先に次の 2 つを書いてください:',
		'1. なぜここで時間を使っているのか（コードを読んで）',
		'2. **速くなったことをどう確かめるか**（同じ計測をどう再現するか）',
		'',
		'そのうえで、直す案を出してください。'
	].join('\n');
}
