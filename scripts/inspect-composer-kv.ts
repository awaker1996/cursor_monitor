/**
 * 针对性检查 composerData 前缀的 KV 内容。
 */
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = path.join(
  process.env.APPDATA ?? '',
  'Cursor',
  'User',
  'globalStorage',
  'state.vscdb',
);

const db = new Database(dbPath, { readonly: true, fileMustExist: true });

console.log('===== composerData:* 前缀的 5 条样本 =====');
const samples = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 500) as preview
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:%'
     LIMIT 5`,
  )
  .all() as { key: string; vlen: number; preview: string }[];
for (const s of samples) {
  console.log(`--- ${s.key} (${s.vlen} bytes)`);
  console.log(s.preview.replace(/\s+/g, ' ').slice(0, 400));
}

console.log('\n===== composerData 数量 + 按前缀分组 =====');
const groups = db
  .prepare(
    `SELECT
      CASE
        WHEN key = 'composerData:allComposers' THEN key
        WHEN instr(substr(key, 14), ':') > 0 THEN 'composerData:…:' || substr(key, 14, instr(substr(key, 14), ':') - 1)
        ELSE key
      END as prefix,
      COUNT(*) as cnt
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:%'
     GROUP BY prefix
     ORDER BY cnt DESC
     LIMIT 20`,
  )
  .all() as { prefix: string; cnt: number }[];
for (const g of groups) {
  console.log(`  ${g.prefix.padEnd(60)} ${g.cnt}`);
}

console.log('\n===== composerData:allComposers 看一眼 =====');
const all = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 800) as preview
     FROM cursorDiskKV
     WHERE key = 'composerData:allComposers'`,
  )
  .all() as { key: string; vlen: number; preview: string }[];
for (const s of all) {
  console.log(`--- ${s.key} (${s.vlen} bytes)`);
  console.log(s.preview.replace(/\s+/g, ' ').slice(0, 800));
}

console.log('\n===== bubbleId:* 前缀的 5 条样本 =====');
const bubbles = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 600) as preview
     FROM cursorDiskKV
     WHERE key LIKE 'bubbleId:%'
     LIMIT 5`,
  )
  .all() as { key: string; vlen: number; preview: string }[];
for (const s of bubbles) {
  console.log(`--- ${s.key} (${s.vlen} bytes)`);
  console.log(s.preview.replace(/\s+/g, ' ').slice(0, 500));
}

console.log('\n===== agentKv:* 前缀的 3 条样本 =====');
const agent = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 600) as preview
     FROM cursorDiskKV
     WHERE key LIKE 'agentKv:%'
     LIMIT 3`,
  )
  .all() as { key: string; vlen: number; preview: string }[];
for (const s of agent) {
  console.log(`--- ${s.key} (${s.vlen} bytes)`);
  console.log(s.preview.replace(/\s+/g, ' ').slice(0, 500));
}

db.close();