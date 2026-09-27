/**
 * 只测第一步：列出最近 composerData 行（验证 schema 探测与排序）。
 * 不展开 bubble，避免大库耗时长。
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import { listComposerRows, readLastUpdatedAt, isSubAgentComposer } from '../src/core/agentTrace/cursorSchema';

const dbPath = path.join(
  process.env.APPDATA ?? '',
  'Cursor',
  'User',
  'globalStorage',
  'state.vscdb',
);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
console.log('读取 composerData: 行...');
const rows = listComposerRows(db);
console.log(`共 ${rows.length} 行`);
const filtered = rows.filter((r) => !isSubAgentComposer(r.key));
filtered.sort((a, b) => readLastUpdatedAt(b) - readLastUpdatedAt(a));
console.log(`过滤 sub-agent 后 ${filtered.length} 行`);
console.log('最近 5 个 composer:');
for (const r of filtered.slice(0, 5)) {
  const v = r.value as { name?: string; lastUpdatedAt?: number; fullConversationHeadersOnly?: unknown[] };
  console.log(`  ${r.key}  name='${v.name?.slice(0, 30)}' lastUpd=${v.lastUpdatedAt} fcho=${(v.fullConversationHeadersOnly || []).length}`);
}
db.close();