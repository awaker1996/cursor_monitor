/**
 * 按 lastUpdatedAt 倒序找最近一个有效 composer，看 conversationMap 真实结构。
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

console.log('===== 按 lastUpdatedAt DESC 取最近 20 个 composer，看哪些有真实对话 =====');
const composers = db
  .prepare(
    `SELECT key, value
     FROM cursorDiskKV
     WHERE key LIKE 'composerData:%'
       AND json_extract(value, '$.lastUpdatedAt') IS NOT NULL
     ORDER BY json_extract(value, '$.lastUpdatedAt') DESC
     LIMIT 20`,
  )
  .all() as { key: string; value: string }[];

for (const c of composers) {
  try {
    const obj = JSON.parse(c.value);
    const cm = obj.conversationMap || {};
    const cmSize = Object.keys(cm).length;
    const fcho = (obj.fullConversationHeadersOnly || []).length;
    const text = (obj.text || '').slice(0, 40);
    const name = (obj.name || '').slice(0, 30);
    console.log(
      `${c.key.padEnd(80)} ` +
      `cm=${String(cmSize).padStart(5)} fcho=${String(fcho).padStart(4)} ` +
      `name='${name}' text='${text}' ` +
      `lastUpd=${obj.lastUpdatedAt}`,
    );
  } catch (err) {
    console.log(`${c.key}: 解析失败`);
  }
}

console.log('\n===== 取最近一个有 conversationMap 的 composer 看真实结构 =====');
for (const c of composers) {
  try {
    const obj = JSON.parse(c.value);
    const cm = obj.conversationMap || {};
    if (Object.keys(cm).length === 0) continue;
    console.log(`\n>>> ${c.key}  cm=${Object.keys(cm).length} fcho=${(obj.fullConversationHeadersOnly || []).length} name='${obj.name}'`);
    console.log(`text: ${(obj.text || '').slice(0, 200)}`);

    console.log(`\nfullConversationHeadersOnly 数组内容：`);
    const fcho = obj.fullConversationHeadersOnly || [];
    for (const h of fcho.slice(0, 8)) {
      console.log(`  ${JSON.stringify(h).slice(0, 200)}`);
    }

    console.log(`\nconversationMap 前 3 个 bubble：`);
    const ids = Object.keys(cm).slice(0, 3);
    for (const bid of ids) {
      const b = cm[bid];
      console.log(`\n--- bubbleId=${bid} ---`);
      if (!b || typeof b !== 'object') {
        console.log(`  非对象: ${JSON.stringify(b).slice(0, 200)}`);
        continue;
      }
      console.log(`  type=${b.type} _v=${b._v} createdAt=${b.createdAt}`);
      console.log(`  text: ${(b.text || '').slice(0, 200)}`);
      if (b.thinking) {
        console.log(`  thinking.text: ${(b.thinking.text || '').slice(0, 300)}`);
      }
      for (const k of ['toolResults', 'toolResult', 'toolCalls', 'toolCall', 'suggestedCodeBlocks', 'interpreterResults', 'editTrailContexts', 'allThinkingBlocks']) {
        if (Array.isArray(b[k]) && b[k].length > 0) {
          console.log(`\n  >>> ${k} (前 1 条) <<<`);
          console.log(`  ${JSON.stringify(b[k][0], null, 2).slice(0, 1500)}`);
        }
      }
    }
    break;
  } catch {
    // ignore
  }
}

db.close();