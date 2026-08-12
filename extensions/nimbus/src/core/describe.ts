/**
 * ツール実行の 1 行サマリ。承認ダイアログとログの両方で使う。
 * VS Code に依存しないので単体で検証できる。
 */

const MAX_LENGTH = 200;

export function describeTool(toolName: string, input: unknown): string {
	if (!input || typeof input !== 'object') {
		return toolName;
	}
	const record = input as Record<string, unknown>;
	// 「何に対して」が分かる代表的な引数を、意味の強い順に拾う
	const primary =
		(typeof record['command'] === 'string' && record['command']) ||
		(typeof record['file_path'] === 'string' && record['file_path']) ||
		(typeof record['path'] === 'string' && record['path']) ||
		(typeof record['pattern'] === 'string' && record['pattern']) ||
		(typeof record['url'] === 'string' && record['url']) ||
		'';
	if (!primary) {
		return toolName;
	}
	const oneLine = primary.replace(/\s+/g, ' ').trim();
	if (!oneLine) {
		return toolName;
	}
	return `${toolName}: ${oneLine.length > MAX_LENGTH ? `${oneLine.slice(0, MAX_LENGTH)}…` : oneLine}`;
}
