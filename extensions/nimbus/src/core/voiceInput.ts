/** 音声で指示する（tasks.md T-055）。実装中 @yua */
export interface Engine { command: string; label: string }
export function pickEngine(available: readonly string[]): Engine | undefined { void available; return undefined; }
