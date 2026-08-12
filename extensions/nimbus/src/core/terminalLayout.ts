/** ターミナルを好きな数に分割する（tasks.md T-014）。実装中 @yua */
export interface Pane { name: string; cwd?: string }
export function planPanes(count: number): Pane[] { void count; return []; }
