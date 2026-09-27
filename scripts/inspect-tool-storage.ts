/**
 * 找包含 "toolName" / "function" / "name":"read_file" 等关键字的 row。
 * 限定 cursorDiskKV 但用 LIKE 缩小到具体前缀避免全表扫。
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

console.log('===== 1. 看 ofsContent:* 的几条样本 =====');
const ofs = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 600) as preview
     FROM cursorDiskKV WHERE key LIKE 'ofsContent:%' LIMIT 3`,
  )
  .all() as { key: string; vlen: number; preview: string }[];
for (const r of ofs) {
  console.log(`\n--- ${r.key} (${r.vlen})`);
  console.log(r.preview.replace(/\s+/g, ' ').slice(0, 500));
}

console.log('\n===== 2. 看 codeBlockPartialInlineDiffFates:* =====');
const cbf = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 600) as preview
     FROM cursorDiskKV WHERE key LIKE 'codeBlockPartialInlineDiffFates:%' LIMIT 3`,
  )
  .all() as { key: string; vlen: number; preview: string }[];
for (const r of cbf) {
  console.log(`\n--- ${r.key} (${r.vlen})`);
  console.log(r.preview.replace(/\s+/g, ' ').slice(0, 500));
}

console.log('\n===== 3. 看 composerData 里的 capabilities[].data.bubbleDataMap =====');
const recentComposer = db
  .prepare(
    `SELECT key, value FROM cursorDiskKV
     WHERE key LIKE 'composerData:%' AND json_extract(value, '$.lastUpdatedAt') IS NOT NULL
     ORDER BY json_extract(value, '$.lastUpdatedAt') DESC LIMIT 1`,
  )
  .get() as { key: string; value: string };

const obj = JSON.parse(recentComposer.value);
console.log(`composer: ${recentComposer.key}`);
console.log(`name: ${obj.name}`);
console.log(`capabilities 数量: ${(obj.capabilities || []).length}`);
for (const [i, cap] of (obj.capabilities || []).entries()) {
  const data = cap.data || {};
  const keys = Object.keys(data);
  console.log(`  [${i}] type=${cap.type} data keys: ${keys.join(', ')}`);
  // bubbleDataMap 是 JSON 字符串
  if (typeof data.bubbleDataMap === 'string' && data.bubbleDataMap !== '{}') {
    console.log(`    bubbleDataMap 长度: ${data.bubbleDataMap.length}`);
    console.log(`    bubbleDataMap 前 500: ${data.bubbleDataMap.slice(0, 500)}`);
  }
}

console.log('\n===== 4. 取这个 composer 的所有 bubble，看是不是真的没有 toolResults =====');
const composerId = recentComposer.key.replace('composerData:', '');
const rows = db
  .prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE ?`)
  .all(`bubbleId:${composerId}:%`) as { key: string; value: string }[];

let toolCount = 0;
let interpreterCount = 0;
let scbCount = 0;
let editCount = 0;
let thinkingCount = 0;
let userTextCount = 0;
let aiTextCount = 0;

for (const r of rows) {
  if (r.value.length < 30) continue;
  try {
    const o = JSON.parse(r.value);
    if (Array.isArray(o.toolResults) && o.toolResults.length > 0) toolCount++;
    if (Array.isArray(o.interpreterResults) && o.interpreterResults.length > 0) interpreterCount++;
    if (Array.isArray(o.suggestedCodeBlocks) && o.suggestedCodeBlocks.length > 0) scbCount++;
    if (Array.isArray(o.editTrailContexts) && o.editTrailContexts.length > 0) editCount++;
    if (o.thinking && o.thinking.text) thinkingCount++;
    if (o.type === 1 && o.text) userTextCount++;
    if (o.type === 2 && o.text) aiTextCount++;
  } catch {}
}

console.log(`共 ${rows.length} 个 bubble：`);
console.log(`  含 thinking: ${thinkingCount}`);
console.log(`  含 toolResults: ${toolCount}`);
console.log(`  含 interpreterResults: ${interpreterCount}`);
console.log(`  含 suggestedCodeBlocks: ${scbCount}`);
console.log(`  含 editTrailContexts: ${editCount}`);
console.log(`  type=1 有 text: ${userTextCount}`);
console.log(`  type=2 有 text: ${aiTextCount}`);

console.log('\n===== 5. 看 capabilities type=15 的 bubbleDataMap 实际结构 =====');
const recentComposer2 = db
  .prepare(
    `SELECT key, value FROM cursorDiskKV
     WHERE key LIKE 'composerData:%'
       AND json_extract(value, '$.lastUpdatedAt') IS NOT NULL
       AND json_extract(value, '$.capabilities[0].data.bubbleDataMap') IS NOT NULL
     ORDER BY json_extract(value, '$.lastUpdatedAt') DESC LIMIT 1`,
  )
  .get() as { key: string; value: string };

if (recentComposer2) {
  const o = JSON.parse(recentComposer2.value);
  console.log(`composer: ${recentComposer2.key}`);
  const cap15 = (o.capabilities || []).find((c: { type: number }) => c.type === 15);
  if (cap15 && cap15.data && cap15.data.bubbleDataMap) {
    const map = JSON.parse(cap15.data.bubbleDataMap);
    console.log(`bubbleDataMap 顶层 keys 数: ${Object.keys(map).length}`);
    console.log('前 3 个 keys:', Object.keys(map).slice(0, 3));
    for (const id of Object.keys(map).slice(0, 1)) {
      console.log(`\n--- bubble ${id} 内容:`);
      const inner = map[id];
      for (const k of Object.keys(inner)) {
        const v = inner[k];
        const summary =
          Array.isArray(v) ? `Array(${v.length})` :
          v === null ? 'null' :
          v === undefined ? 'undefined' :
          typeof v === 'object' ? 'Object' :
          typeof v === 'string' ? `String(${(v as string).length})` :
          typeof v;
        console.log(`  ${k.padEnd(40)} = ${summary}`);
      }
      // 重要字段
      for (const k of ['toolResults', 'interpreterResults', 'suggestedCodeBlocks', 'editTrailContexts', 'thinking']) {
        if (inner[k]) {
          console.log(`\n>>> ${k}:`);
          console.log(JSON.stringify(inner[k], null, 2).slice(0, 2500));
        }
      }
    }
  }
}

db.close();