/**
 * セッション → スキル化（tasks.md T-168）。
 *
 * うまくいった手順は、そのセッションが終われば消える。次に同じことをするとき、
 * また一から指示することになる。**うまくいった流れを型として残す**。
 *
 * 書くのは「手順の骨格」まで。中身を練るのは Claude の仕事なので、
 * ここは**エディタでないと分からないこと**だけを埋める —
 * 実際に出した指示、実際に触ったファイル、実際に走らせたテスト。
 *
 * VS Code に依存しないので単体で検証できる。
 */
import type { NimbusEvent } from '../events';
import { buildAttributions } from './activity';
import { collectEvidence } from './evidence';

export interface SkillDraft {
	/** ディレクトリ名にも使う。英小文字とハイフンに寄せる */
	name: string;
	description: string;
	body: string;
}

/** frontmatter の `name` に使える形へ寄せる（ディレクトリ名になるため） */
export function toSkillName(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return slug || 'nimbus-skill';
}

/**
 * セッションからスキルの下書きを作る。
 *
 * **指示を出した順に手順として並べる。** その指示で何を触ったかを添えるが、
 * 具体的なパスは次に使うときに変わるので、**参考として括弧に入れる**
 * （手順そのものに焼き込むと、別の場所では使えない型になる）。
 */
export function draftSkill(events: readonly NimbusEvent[], name: string, description: string): SkillDraft {
	const evidence = collectEvidence(events);
	// 古い順に並べ直す（buildAttributions は新しい順に返す）
	const steps = [...buildAttributions(events)].reverse();

	const lines: string[] = [];
	lines.push('## 何をするスキルか', '', description || '（ここに、どんなときに使うかを書く）', '');

	lines.push('## 手順', '');
	if (steps.length === 0) {
		lines.push('1. （ここに手順を書く）', '');
	} else {
		steps.forEach((step, index) => {
			lines.push(`${index + 1}. ${step.prompt.replace(/\s+/g, ' ').trim()}`);
			const touched = step.edits.map((edit) => edit.path);
			if (touched.length > 0) {
				lines.push(`   - このとき触ったもの（参考）: ${touched.map((path) => `\`${path}\``).join(' / ')}`);
			}
		});
		lines.push('');
	}

	lines.push('## 確かめかた', '');
	if (evidence.runs.length === 0) {
		// テストを走らせていないなら、そう書く。書かないと「確かめた」ことになってしまう
		lines.push('このセッションではテストを実行していません。確かめかたを書いてください。', '');
	} else {
		for (const run of evidence.runs) {
			lines.push(`- \`${run.command}\`（このときの結果: ${run.outcome === 'passed' ? '成功' : run.outcome === 'failed' ? '失敗' : '判定できず'}）`);
		}
		lines.push('');
	}

	lines.push(
		'## 気をつけること',
		'',
		'- （うまくいかなかったやり方があれば、ここに残す）',
		''
	);

	return { name: toSkillName(name), description, body: lines.join('\n') };
}

/** `SKILL.md` の中身にする（frontmatter つき） */
export function renderSkillFile(draft: SkillDraft): string {
	// description は 1 行に畳む。折り返すと frontmatter が壊れる
	const description = draft.description.replace(/\s+/g, ' ').trim() || draft.name;
	return `---\nname: ${draft.name}\ndescription: ${description}\n---\n\n${draft.body}`;
}
