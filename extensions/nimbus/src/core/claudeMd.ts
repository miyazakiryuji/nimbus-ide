/**
 * CLAUDE.md の探索。VS Code に依存しないので単体で検証できる。
 */
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

/**
 * cwd から上へ辿って CLAUDE.md を集める（Claude Code の探索と同じ考え方）。
 * ホーム直下のものも対象。存在するものだけを返す。
 */
export function findClaudeMdFiles(cwd: string, home: string = homedir()): string[] {
	const found: string[] = [];
	let dir = cwd;
	for (;;) {
		const candidate = join(dir, 'CLAUDE.md');
		if (existsSync(candidate)) {
			found.push(candidate);
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	const userLevel = join(home, '.claude', 'CLAUDE.md');
	if (existsSync(userLevel) && !found.includes(userLevel)) {
		found.push(userLevel);
	}
	return found;
}
