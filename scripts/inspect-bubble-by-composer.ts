/**
 * 找出有 bubble 的 composerId，再随机选一个看完整 bubble 结构。
 * 通过 bubbleId 前缀聚合，比 ORDER BY length 简单。
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

console.log('===== 统计每个 composerId 的 bubble 数量（按数量倒序） =====');
const grouped = db
  .prepare(
    `SELECT
      CASE
        WHEN instr(key, ':') > 0
        THEN substr(key, 10, instr(substr(key, 10), ':') - 1)
        ELSE key
      END as composerId,
      COUNT(*) as bubbleCount
     FROM cursorDiskKV
     WHERE key LIKE 'bubbleId:%'
     GROUP BY composerId
     ORDER BY bubbleCount DESC
     LIMIT 10`,
  )
  .all() as { composerId: string; bubbleCount: number }[];
for (const r of grouped) {
  console.log(`  ${r.composerId}  bubbles=${r.bubbleCount}`);
}

if (grouped.length > 0) {
  const targetComposerId = grouped[0].composerId;
  console.log(`\n===== 取 ${targetComposerId} 的前 5 个 bubble 看完整结构 =====`);
  const bubbles = db
    .prepare(
      `SELECT key, value FROM cursorDiskKV
       WHERE key LIKE ?
       LIMIT 5`,
    )
    .all(`bubbleId:${targetComposerId}:%`) as { key: string; value: string }[];

  for (const b of bubbles) {
    const bubbleId = b.key.split(':').slice(2).join(':');
    const obj = JSON.parse(b.value);
    console.log(`\n--- bubbleId=${bubbleId} type=${obj.type} _v=${obj._v}`);
    console.log(`text: ${(obj.text || '').slice(0, 200)}`);
    console.log(`所有 keys（带摘要）：`);
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const summary =
        Array.isArray(v) ? `Array(${v.length})` :
        v === null ? 'null' :
        v === undefined ? 'undefined' :
        typeof v === 'object' ? 'Object' :
        typeof v === 'string' ? `String(${(v as string).length})` :
        typeof v;
      console.log(`  ${k.padEnd(40)} = ${summary}`);
    }
    // 重点字段原始内容
    for (const k of ['reasoning', 'thinking', 'toolCall', 'toolCalls', 'toolResults', 'toolResult', 'suggestedCodeBlocks', 'interpreterResults', 'agentPlan', 'toolFormerData', 'tool']) {
      if (k in obj && obj[k] !== null && obj[k] !== undefined) {
        const s = JSON.stringify(obj[k]);
        if (s !== 'null' && s !== '[]' && s !== '{}') {
          console.log(`\n  >>> ${k} <<<`);
          console.log(`  ${s.slice(0, 2000)}`);
        }
      }
    }
  }
}

db.close();