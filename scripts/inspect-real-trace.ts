/**
 * 跑真实 state.vscdb，看 parser 输出多少 turn、按时间排序后第一个 turn 长啥样。
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { parseLatestTrace } from '../src/core/agentTrace/parser';

const dbPath = path.join(
  process.env.APPDATA ?? '',
  'Cursor',
  'User',
  'globalStorage',
  'state.vscdb',
);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
const parsed = parseLatestTrace(db);
console.log(`composerId: ${parsed.composerId}`);
console.log(`composerName: ${parsed.composerName}`);
console.log(`lastUpdatedAt: ${new Date(parsed.lastUpdatedAt).toISOString()}`);
console.log(`warnings: ${parsed.warnings.join(' | ') || '(无)'}`);
console.log(`turns: ${parsed.turns.length}`);
console.log('前 10 个 turn：');
for (const t of parsed.turns.slice(0, 10)) {
  console.log(`  [${t.index}] ${t.type.padEnd(11)} ts=${t.timestampMs ? new Date(t.timestampMs).toISOString() : '—'}`);
  console.log(`      ${t.text.slice(0, 120).replace(/\n/g, ' ')}`);
  if (t.payload) {
    console.log(`      payload: ${t.payload.slice(0, 120).replace(/\n/g, ' ')}`);
  }
}
const types = parsed.turns.reduce<Record<string, number>>((acc, t) => {
  acc[t.type] = (acc[t.type] || 0) + 1;
  return acc;
}, {});
console.log('\n按类型统计：');
for (const [k, v] of Object.entries(types)) {
  console.log(`  ${k.padEnd(12)} ${v}`);
}

db.close();