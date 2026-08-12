/** スキルを配れる形にする（tasks.md T-070）。実装中 @yua */
export interface PackagePlan { plugins: { name: string }[] }
export function planPackage(): PackagePlan { return { plugins: [] }; }
