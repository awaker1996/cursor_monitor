/**
 * 只针对一个 composer (fb11a99d, 32429 bubbles) 抓所有 bubble，然后在 Node 里筛选。
 * 这样避免大表全表扫描。
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

const composerId = 'fb11a99d-c47d-4f7f-b048-1177dc39aa43';
console.log(`读取 composer ${composerId} 的所有 bubble...`);
const rows = db
  .prepare(
    `SELECT key, value FROM cursorDiskKV WHERE key LIKE ?`,
  )
  .all(`bubbleId:${composerId}:%`) as { key: string; value: string }[];
console.log(`共 ${rows.length} 条`);

let withToolResults: { key: string; value: string } | null = null;
let withInterp: { key: string; value: string } | null = null;
let withScb: { key: string; value: string } | null = null;
let withEdit: { key: string; value: string } | null = null;
let withAllThinking: { key: string; value: string } | null = null;
let withThinking: { key: string; value: string } | null = null;

for (const r of rows) {
  if (r.value.length < 50) continue;
  if (!withToolResults && r.value.includes('"toolResults":[{"')) withToolResults = r;
  if (!withInterp && r.value.includes('"interpreterResults":[{"')) withInterp = r;
  if (!withScb && r.value.includes('"suggestedCodeBlocks":[{"')) withScb = r;
  if (!withEdit && r.value.includes('"editTrailContexts":[{"')) withEdit = r;
  if (!withAllThinking && r.value.includes('"allThinkingBlocks":[{"')) withAllThinking = r;
  if (!withThinking && r.value.includes('"thinking":{"')) withThinking = r;
}

function dump(label: string, row: { key: string; value: string } | null) {
  if (!row) {
    console.log(`\n===== ${label} ：未找到 =====`);
    return;
  }
  console.log(`\n===== ${label} =====`);
  console.log(`key: ${row.key}`);
  try {
    const obj = JSON.parse(row.value);
    console.log(`type=${obj.type} _v=${obj._v} createdAt=${obj.createdAt}`);
    console.log(`text: ${(obj.text || '').slice(0, 200)}`);
    if (obj.thinking) {
      console.log(`thinking.text: ${(obj.thinking.text || '').slice(0, 400)}`);
    }
    for (const k of ['toolResults', 'interpreterResults', 'suggestedCodeBlocks', 'editTrailContexts', 'allThinkingBlocks']) {
      if (Array.isArray(obj[k]) && obj[k].length > 0) {
        console.log(`\n>>> ${k} (前 2 条) <<<`);
        for (const item of obj[k].slice(0, 2)) {
          console.log(JSON.stringify(item, null, 2).slice(0, 2500));
          console.log('---');
        }
      }
    }
  } catch (err) {
    console.log(`解析失败: ${err}`);
  }
}

dump('thinking 字段', withThinking);
dump('toolResults', withToolResults);
dump('interpreterResults', withInterp);
dump('suggestedCodeBlocks', withScb);
dump('editTrailContexts', withEdit);
dump('allThinkingBlocks', withAllThinking);

db.close();