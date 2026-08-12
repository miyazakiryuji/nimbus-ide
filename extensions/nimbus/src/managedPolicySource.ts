/**
 * 組織が置いた制限を、設定から読む（tasks.md T-212）。
 *
 * 判断は `core/managedPolicy.ts`。ここは**どこから読むか**だけを 1 か所に決める。
 * 読む場所を間違えると制限が制限にならないので、複数箇所に散らさない。
 */
import * as vscode from 'vscode';
import type { ManagedPolicy } from './core/managedPolicy';

/**
 * `nimbus.managedPolicy` を**ユーザー設定からだけ**読む。
 *
 * ワークスペース設定を見てはいけない。見ると、
 * **`.vscode/settings.json` を含むリポジトリを開かせるだけで制限を外せる**。
 * 設定自体も `"scope": "machine"` にしてあるので、ワークスペースには書けない。
 */
export function readManagedPolicy(): ManagedPolicy | undefined {
	const inspected = vscode.workspace.getConfiguration('nimbus').inspect<ManagedPolicy>('managedPolicy');
	return inspected?.globalValue;
}
