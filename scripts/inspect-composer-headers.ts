/**
 * 进一步检查 composerHeaders 表里 value 字段的实际内容，
 * 帮助决定 parser 该如何解析。
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

console.log('===== composerHeaders 行数 =====');
const count = db.prepare('SELECT COUNT(*) as c FROM composerHeaders').get() as { c: number };
console.log(`共 ${count.c} 行`);

console.log('\n===== 最新 3 行（按 lastUpdatedAt 倒序）=====');
const rows = db
  .prepare(
    'SELECT composerId, workspaceId, createdAt, lastUpdatedAt, isArchived, isSubagent, recency, checkpointAt, length(value) as vlen, substr(value, 1, 500) as preview FROM composerHeaders ORDER BY lastUpdatedAt DESC LIMIT 3',
  )
  .all() as Record<string, unknown>[];
for (const row of rows) {
  console.log('---');
  for (const [k, v] of Object.entries(row)) {
    if (k === 'preview') {
      console.log(`  ${k}: ${String(v).replace(/\s+/g, ' ').slice(0, 300)}`);
    } else {
      console.log(`  ${k}: ${v}`);
    }
  }
}

console.log('\n===== 最新一行的 value 字段前 2000 字符（尝试看是否是 JSON）=====');
const top = rows[0];
if (top) {
  const full = db
    .prepare('SELECT value FROM composerHeaders WHERE composerId = ?')
    .get(top.composerId) as { value: unknown };
  const txt = typeof full.value === 'string' ? full.value : '';
  console.log(`长度: ${txt.length}`);
  console.log(`前 2000 字:`);
  console.log(txt.slice(0, 2000));
}

console.log('\n===== 是否是 JSON =====');
if (top) {
  const full = db
    .prepare('SELECT value FROM composerHeaders WHERE composerId = ?')
    .get(top.composerId) as { value: unknown };
  const txt = typeof full.value === 'string' ? full.value : '';
  try {
    const parsed = JSON.parse(txt);
    console.log('  是 JSON，顶层 type:', typeof parsed);
    if (parsed && typeof parsed === 'object') {
      console.log('  顶层 keys:', Object.keys(parsed).join(', '));
      if ('bubbles' in parsed) console.log('  bubbles.length:', (parsed as { bubbles: unknown[] }).bubbles.length);
      if ('messages' in parsed) console.log('  messages.length:', (parsed as { messages: unknown[] }).messages.length);
      if ('turns' in parsed) console.log('  turns.length:', (parsed as { turns: unknown[] }).turns.length);
    }
  } catch (err) {
    console.log(`  不是有效 JSON: ${err}`);
    // 看是否可能是 protobuf
    const head = txt.slice(0, 32);
    console.log(`  头部 hex: ${Buffer.from(head).toString('hex')}`);
  }
}

db.close();