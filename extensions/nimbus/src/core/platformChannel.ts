/**
 * Dart とネイティブの橋渡しを突き合わせる（tasks.md T-200 Platform Channel）。
 *
 * `MethodChannel` は**文字列で繋がっている**。名前を書き間違えても、引数を変えても、
 * コンパイルは通る。落ちるのは実機で触ったときで、しかも
 * `MissingPluginException` としか出ない（どちら側が悪いのか分からない）。
 *
 * 文字列どうしを突き合わせれば分かることなので、先に見せる。
 * VS Code に依存しないので単体で検証できる。
 */

export interface ChannelUsage {
	/** チャネル名 */
	channel: string;
	/** そのチャネルで呼ばれている／扱われているメソッド名 */
	methods: string[];
	file: string;
}

export interface ChannelFinding {
	kind: 'no-handler' | 'unused-handler' | 'unknown-channel';
	channel: string;
	method?: string;
	message: string;
}

const DART_CHANNEL = /MethodChannel\(\s*['"]([^'"]+)['"]/g;
const DART_INVOKE = /invokeMethod(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g;

const SWIFT_CHANNEL = /FlutterMethodChannel\(\s*name:\s*"([^"]+)"/g;
const KOTLIN_CHANNEL = /MethodChannel\([^,]+,\s*"([^"]+)"/g;

/** ネイティブ側で処理しているメソッド名（`case "x"` / `"x" ->` / `== "x"`） */
const NATIVE_METHOD = /(?:case\s+"([^"]+)"|"([^"]+)"\s*->|\bmethod\s*==\s*"([^"]+)")/g;

function collect(content: string, pattern: RegExp): string[] {
	return [...new Set([...content.matchAll(pattern)].map((match) => match[1]))];
}

/** Dart 側の使い方。チャネルは 1 ファイルに 1 つのことが多いので、まとめて扱う */
export function parseDart(file: string, content: string): ChannelUsage[] {
	const channels = collect(content, DART_CHANNEL);
	if (channels.length === 0) {
		return [];
	}
	const methods = collect(content, DART_INVOKE);
	return channels.map((channel) => ({ channel, methods, file }));
}

/** ネイティブ側（Swift / Kotlin）の受け口 */
export function parseNative(file: string, content: string): ChannelUsage[] {
	const channels = [...collect(content, SWIFT_CHANNEL), ...collect(content, KOTLIN_CHANNEL)];
	if (channels.length === 0) {
		return [];
	}
	const methods = [
		...new Set(
			[...content.matchAll(NATIVE_METHOD)].map((match) => match[1] ?? match[2] ?? match[3]).filter(Boolean) as string[]
		)
	];
	return channels.map((channel) => ({ channel, methods, file }));
}

/**
 * 突き合わせる。
 *
 * **「無い」と言えるのは、そのチャネルの受け口が見つかっているときだけ。**
 * ネイティブ側が見つからない（プラグイン提供など）チャネルは、判定せずに別枠で出す。
 */
export function crossCheck(dart: readonly ChannelUsage[], native: readonly ChannelUsage[]): ChannelFinding[] {
	const findings: ChannelFinding[] = [];
	const nativeByChannel = new Map<string, Set<string>>();
	for (const usage of native) {
		const set = nativeByChannel.get(usage.channel) ?? new Set<string>();
		usage.methods.forEach((method) => set.add(method));
		nativeByChannel.set(usage.channel, set);
	}

	for (const usage of dart) {
		const handled = nativeByChannel.get(usage.channel);
		if (!handled) {
			findings.push({
				kind: 'unknown-channel',
				channel: usage.channel,
				message: 'ネイティブ側の受け口が見つかりません（プラグインが提供しているなら問題ありません）'
			});
			continue;
		}
		for (const method of usage.methods) {
			if (!handled.has(method)) {
				findings.push({
					kind: 'no-handler',
					channel: usage.channel,
					method,
					message: '呼んでいるのに、ネイティブ側で処理していません（実機で MissingPluginException になります）'
				});
			}
		}
	}

	const dartByChannel = new Map<string, Set<string>>();
	for (const usage of dart) {
		const set = dartByChannel.get(usage.channel) ?? new Set<string>();
		usage.methods.forEach((method) => set.add(method));
		dartByChannel.set(usage.channel, set);
	}
	for (const usage of native) {
		const called = dartByChannel.get(usage.channel);
		if (!called) {
			continue;
		}
		for (const method of usage.methods) {
			if (!called.has(method)) {
				findings.push({
					kind: 'unused-handler',
					channel: usage.channel,
					method,
					message: 'ネイティブ側にありますが、Dart から呼ばれていません'
				});
			}
		}
	}

	return findings.sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.channel.localeCompare(b.channel) || (a.method ?? '').localeCompare(b.method ?? '')
	);
}

export function renderChannelFindings(findings: readonly ChannelFinding[]): string {
	if (findings.length === 0) {
		return '# Platform Channel の突き合わせ\n\n食い違いは見つかりませんでした。\n';
	}

	const lines = ['# Platform Channel の突き合わせ', ''];
	const missing = findings.filter((finding) => finding.kind === 'no-handler');
	const unused = findings.filter((finding) => finding.kind === 'unused-handler');
	const unknown = findings.filter((finding) => finding.kind === 'unknown-channel');

	if (missing.length > 0) {
		lines.push('## 呼んでいるのに、受け口がありません', '', '実機で `MissingPluginException` になります。', '');
		for (const finding of missing) {
			lines.push(`- \`${finding.channel}\` の \`${finding.method}\``);
		}
		lines.push('');
	}
	if (unused.length > 0) {
		lines.push('## ネイティブ側にあるのに、呼ばれていません', '');
		for (const finding of unused) {
			lines.push(`- \`${finding.channel}\` の \`${finding.method}\``);
		}
		lines.push('');
	}
	if (unknown.length > 0) {
		lines.push('## 受け口が見つからないチャネル', '', 'プラグインが提供しているなら問題ありません。', '');
		for (const finding of unknown) {
			lines.push(`- \`${finding.channel}\``);
		}
		lines.push('');
	}

	return lines.join('\n');
}
