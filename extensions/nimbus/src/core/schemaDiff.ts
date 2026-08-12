/** スキーマ差分からマイグレーションを起こす（tasks.md T-125）。実装中 @yua */
export interface Column { name: string; type: string; notNull: boolean }
export interface Table { name: string; columns: Column[] }
export function parseSchema(sql: string): Table[] { void sql; return []; }
