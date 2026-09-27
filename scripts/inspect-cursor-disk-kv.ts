/**
 * 检查 cursorDiskKV 的 key 模式与典型 value 结构。
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

console.log('===== cursorDiskKV 行数 =====');
const count = db.prepare('SELECT COUNT(*) as c FROM cursorDiskKV').get() as { c: number };
console.log(`共 ${count.c} 行`);

console.log('\n===== 按 key 前缀分组的行数 =====');
const groups = db
  .prepare(
    `SELECT
      CASE
        WHEN instr(key, ':') > 0 THEN substr(key, 1, instr(key, ':') - 1)
        WHEN instr(key, '/') > 0 THEN substr(key, 1, instr(key, '/') - 1)
        ELSE key
      END as prefix,
      COUNT(*) as cnt
    FROM cursorDiskKV
    GROUP BY prefix
    ORDER BY cnt DESC
    LIMIT 30`,
  )
  .all() as { prefix: string; cnt: number }[];
for (const g of groups) {
  console.log(`  ${g.prefix.padEnd(40)} ${g.cnt}`);
}

console.log('\n===== 找包含 "composer" / "agent" / "bubble" 的 key =====');
const interesting = db
  .prepare(
    `SELECT key, length(value) as vlen
     FROM cursorDiskKV
     WHERE key LIKE '%composer%' COLLATE NOCASE
        OR key LIKE '%agent%' COLLATE NOCASE
        OR key LIKE '%bubble%' COLLATE NOCASE
        OR key LIKE '%conversation%' COLLATE NOCASE
        OR key LIKE '%chat%' COLLATE NOCASE
     ORDER BY vlen DESC
     LIMIT 30`,
  )
  .all() as { key: string; vlen: number }[];
console.log(`命中 ${interesting.length} 条`);
for (const r of interesting) {
  console.log(`  ${r.key.padEnd(70)} value=${r.vlen} bytes`);
}

console.log('\n===== 含 composerData/bubbleData 类关键字前 5 条 value 前 100 字符 =====');
const samples = db
  .prepare(
    `SELECT key, substr(value, 1, 200) as preview
     FROM cursorDiskKV
     WHERE key LIKE '%composerData%' COLLATE NOCASE
        OR key LIKE '%bubbleData%' COLLATE NOCASE
     LIMIT 5`,
  )
  .all() as { key: string; preview: unknown }[];
for (const s of samples) {
  console.log(`--- ${s.key}`);
  console.log(String(s.preview).replace(/\s+/g, ' ').slice(0, 200));
}

db.close();