/**
 * タブ（セッションの束）の読み書き（tasks.md T-314）。
 *
 * 判断は `core/sessionGroups.ts`。ここは**置き場所と書きかた**だけを持つ。
 *
 * 台帳（`sessionStore.ts`）と違い、こちらは **1 ファイル**（`groups.json`）。
 * タブの定義と所属は、作る・改名する・入れ替えるときにしか変わらず（低頻度）、
 * イベントのたびに書く台帳とは書き込みの性格が違う。
 * 書くときは台帳と同じく**別名で書いてから置き換える**（rename は不可分）。
 * 同時に書けば後勝ちになるが、賭けているのはタブの名前と所属だけで、
 * セッションそのものは台帳側にある（負けても取り返しがつく）。
 */
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { emptyGroups, normalizeGroups, type GroupsFile } from './core/sessionGroups';

export class GroupStore {
	private readonly file: string;
	private readonly log: (message: string) => void;
	/** 直列化の要。読み→変換→書きが重ならないように、書き込みは前の完了へ繋ぐ */
	private chain: Promise<void> = Promise.resolve();

	constructor(dir: string, options: { log?: (message: string) => void } = {}) {
		this.file = join(dir, 'groups.json');
		this.log = options.log ?? (() => undefined);
	}

	/** いまの定義と所属。無ければ空（初回はファイルを作らない — 読むだけで書かない） */
	async load(): Promise<GroupsFile> {
		try {
			return normalizeGroups(JSON.parse(await readFile(this.file, 'utf8')));
		} catch {
			// 無い・読めないは同じ扱い。壊れていた場合も、次の保存で形が直る
			return emptyGroups();
		}
	}

	/**
	 * 読み→変換→書き を 1 つの塊として直列に走らせる。
	 *
	 * 「読んでから書くまで」の間に自分の別の更新が割り込むと、後から来たほうが
	 * 先の変更を黙って上書きする（同一ウィンドウ内の競合）。ウィンドウをまたぐ競合は
	 * 後勝ちを受け入れるが、**自分の中でまで負ける**ことはない。
	 */
	async update(change: (file: GroupsFile) => GroupsFile): Promise<GroupsFile> {
		let result = emptyGroups();
		this.chain = this.chain.then(async () => {
			const current = await this.load();
			const next = change(current);
			result = next;
			if (next === current) {
				return;
			}
			await mkdir(join(this.file, '..'), { recursive: true });
			const temporary = `${this.file}.${process.pid}.tmp`;
			try {
				await writeFile(temporary, `${JSON.stringify(next, null, 1)}\n`, 'utf8');
				await rename(temporary, this.file);
			} catch (error) {
				this.log(`[groups] 保存できませんでした: ${error instanceof Error ? error.message : String(error)}`);
				try {
					await rm(temporary, { force: true });
				} catch {
					// 消せなくても次の書き込みで上書きされる
				}
			}
		});
		await this.chain;
		return result;
	}
}
