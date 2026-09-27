/**
 * 找一个 composer（看 key 模式找出 composerId 范围），直接看它的第一个 bubble。
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

console.log('===== 找一个 composer 头部，看 richText / conversationMap / fullConversationHeadersOnly =====');
const headers = db
  .prepare(
    `SELECT key, length(value) as vlen, value
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:________-____-____-____-____________'
     LIMIT 1`,
  )
  .get() as { key: string; vlen: number; value: string };
console.log(`key: ${headers.key} (${headers.vlen} bytes)`);

const obj = JSON.parse(headers.value);
console.log('composerId:', obj.composerId);
console.log('richText (前 400):', (obj.richText || '').slice(0, 400));
console.log('fullConversationHeadersOnly.length:', (obj.fullConversationHeadersOnly || []).length);
console.log('conversationMap keys:', Object.keys(obj.conversationMap || {}).length);

const headerIds = obj.fullConversationHeadersOnly || [];
console.log('\nfullConversationHeadersOnly 内容（前 10 个）：');
for (const id of headerIds.slice(0, 10)) {
  console.log(`  ${id}`);
}

console.log('\nconversationMap 内容（前 5 个 entry）：');
const cmap = obj.conversationMap || {};
for (const [id, info] of Object.entries(cmap).slice(0, 5)) {
  console.log(`--- ${id}`);
  console.log(JSON.stringify(info, null, 2).slice(0, 800));
}

console.log('\n===== 取 headerIds 中第一个 bubble 看完整结构 =====');
if (headerIds.length > 0) {
  const bubbleId = headerIds[0];
  const composerId = obj.composerId;
  const row = db
    .prepare(
      `SELECT value FROM cursorDiskKV WHERE key = ?`,
    )
    .get(`bubbleId:${composerId}:${bubbleId}`) as { value: string } | undefined;
  if (row) {
    const b = JSON.parse(row.value);
    console.log(`bubble ${bubbleId}:`);
    console.log('  type:', b.type);
    console.log('  text:', (b.text || '').slice(0, 200));
    console.log('\n所有 keys：');
    for (const k of Object.keys(b)) {
      const v = b[k];
      const summary =
        Array.isArray(v) ? `Array(${v.length})` :
        v === null ? 'null' :
        v === undefined ? 'undefined' :
        typeof v === 'object' ? 'Object' :
        typeof v === 'string' ? `String(${(v as string).length})` :
        typeof v;
      console.log(`  ${k.padEnd(40)} = ${summary}`);
    }
    // 关键字段原始值
    for (const k of ['text', 'reasoning', 'thinking', 'toolResults', 'toolCall', 'toolCalls', 'suggestedCodeBlocks', 'interpreterResults', 'agentPlan']) {
      if (k in b) {
        console.log(`\n--- ${k} ---`);
        console.log(JSON.stringify(b[k], null, 2).slice(0, 1500));
      }
    }
  } else {
    console.log('  该 bubble 不存在');
  }
}

console.log('\n===== 含 reasoning 的 bubble 数量 =====');
const withReasoning = db
  .prepare(
    `SELECT COUNT(*) as c
     FROM cursorDiskKV
     WHERE key LIKE 'bubbleId:%'
       AND value LIKE '%reasoning%'`,
  )
  .get() as { c: number };
console.log(`  ${withReasoning.c} 条`);

console.log('\n===== 含 toolCall 的 bubble 数量 =====');
const withToolCall = db
  .prepare(
    `SELECT COUNT(*) as c
     FROM cursorDiskKV
     WHERE key LIKE 'bubbleId:%'
       AND value LIKE '%toolCall%'`,
  )
  .get() as { c: number };
console.log(`  ${withToolCall.c} 条`);

db.close();