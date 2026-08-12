/** プロファイル結果を読む（tasks.md T-128）。実装中 @yua */
export interface HotSpot { name: string; file?: string; selfMs: number }
export function parseProfile(json: string): HotSpot[] { void json; return []; }
