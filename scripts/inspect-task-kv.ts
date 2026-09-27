/**
 * 看 task-tool_* / task-call_* / codeBlockPartialInlineDiffFates 的内容。
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

console.log('===== composerData:task-tool_* 数量 + 一条样本 =====');
const taskTool = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 1500) as preview
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:task-tool_%'
     LIMIT 1`,
  )
  .get() as { key: string; vlen: number; preview: string } | undefined;
console.log(taskTool);

console.log('\n===== composerData:task-call_* 数量 + 一条样本 =====');
const taskCall = db
  .prepare(
    `SELECT key, length(value) as vlen, substr(value, 1, 1500) as preview
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:task-call_%'
     LIMIT 1`,
  )
  .get() as { key: string; vlen: number; preview: string } | undefined;
console.log(taskCall);

console.log('\n===== composerData:task-* 各前缀行数 =====');
const groups = db
  .prepare(
    `SELECT
      CASE
        WHEN instr(key, ':') > 0
        THEN substr(key, 1, instr(substr(key, 14), ':') + 13)
        ELSE key
      END as prefix,
      COUNT(*) as cnt
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:task-%'
     GROUP BY prefix
     ORDER BY cnt DESC
     LIMIT 20`,
  )
  .all() as { prefix: string; cnt: number }[];
for (const g of groups) {
  console.log(`  ${g.prefix.padEnd(80)} ${g.cnt}`);
}

console.log('\n===== 取最新一条 composerData:task-* 看完整结构 =====');
const recentTask = db
  .prepare(
    `SELECT key, value
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:task-%'
     ORDER BY key DESC
     LIMIT 1`,
  )
  .get() as { key: string; value: string };
console.log(`key: ${recentTask.key}`);
try {
  const obj = JSON.parse(recentTask.value);
  console.log('顶层 keys:');
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
  // 看几个关键字段
  for (const k of ['name', 'toolName', 'args', 'arguments', 'input', 'output', 'result', 'status', 'type', 'kind']) {
    if (obj[k] !== undefined && obj[k] !== null) {
      console.log(`\n--- ${k} ---`);
      console.log(JSON.stringify(obj[k], null, 2).slice(0, 1500));
    }
  }
} catch (err) {
  console.log(`解析失败: ${err}`);
}

console.log('\n===== 看 bubbleId 中前 200000 条 value 长度分布（判断是否真的有工具数据） =====');
console.log('提示：实际上 Bubble 里的 toolResults/suggestedCodeBlocks 都是空的，说明这些工具数据存到了 composerData:task-* 里。');

db.close();