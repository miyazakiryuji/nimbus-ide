/** 作業の様子を GIF にする（tasks.md T-223）。実装中 @yua */
export interface CapturePlan { frames: number; intervalMs: number }
export function planCapture(seconds: number, fps: number): CapturePlan { void seconds; void fps; return { frames: 0, intervalMs: 0 }; }
