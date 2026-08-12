/** プラグインの一覧と有効／無効（tasks.md T-032）。実装中 @yua */
export interface PluginRow { id: string; name: string; marketplace: string; enabled: boolean }
export function parseInstalled(json: string): PluginRow[] { void json; return []; }
