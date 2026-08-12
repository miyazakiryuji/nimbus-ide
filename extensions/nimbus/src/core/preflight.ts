/** デプロイ前チェックリスト（tasks.md T-215）。実装中 @yua */
export interface Check { id: string; label: string; blocking: boolean }
export function checklist(): Check[] { return []; }
