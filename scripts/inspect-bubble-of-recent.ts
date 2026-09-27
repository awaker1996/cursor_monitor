/**
 * 把最近一个 composer 的所有 bubble 一次性取出（用 LIKE 限定前缀，快）。
 * 找有 thinking / toolResults 的真实 bubble 看完整结构。
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

const recentComposer = 'composerData:2c8eba91-05c7-4594-b338-e6c8856a55c0';
const composerId = recentComposer.replace('composerData:', '');
console.log(`读 composer ${composerId} 的所有 bubble...`);

const rows = db
  .prepare(
    `SELECT key, value FROM cursorDiskKV WHERE key LIKE ?`,
  )
  .all(`bubbleId:${composerId}:%`) as { key: string; value: string }[];
console.log(`共 ${rows.length} 条 bubble`);

let withThinking: { key: string; value: string } | null = null;
let withToolResults: { key: string; value: string } | null = null;
let withInterpreter: { key: string; value: string } | null = null;
let withCodeBlock: { key: string; value: string } | null = null;
let withAllThinking: { key: string; value: string } | null = null;
let withEdit: { key: string; value: string } | null = null;

for (const r of rows) {
  if (r.value.length < 50) continue;
  if (!withThinking && /"thinking"\s*:\s*\{\s*"text"/.test(r.value)) withThinking = r;
  if (!withToolResults && /"toolResults"\s*:\s*\[/.test(r.value) && r.value.includes('"toolResults":[{')) withToolResults = r;
  if (!withInterpreter && /"interpreterResults"\s*:\s*\[/.test(r.value) && r.value.includes('"interpreterResults":[{')) withInterpreter = r;
  if (!withCodeBlock && /"suggestedCodeBlocks"\s*:\s*\[/.test(r.value) && r.value.includes('"suggestedCodeBlocks":[{')) withCodeBlock = r;
  if (!withAllThinking && /"allThinkingBlocks"\s*:\s*\[/.test(r.value) && r.value.includes('"allThinkingBlocks":[{')) withAllThinking = r;
  if (!withEdit && /"editTrailContexts"\s*:\s*\[/.test(r.value) && r.value.includes('"editTrailContexts":[{')) withEdit = r;
}

console.log(`\n命中统计：`);
console.log(`  thinking=${!!withThinking} toolResults=${!!withToolResults} interpreter=${!!withInterpreter} suggestedCodeBlocks=${!!withCodeBlock} allThinkingBlocks=${!!withAllThinking} editTrailContexts=${!!withEdit}`);

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
      console.log(`thinking.text: ${(obj.thinking.text || '').slice(0, 300)}`);
      console.log(`thinking.signature: ${obj.thinking.signature || ''}`);
    }
    for (const k of ['toolResults', 'interpreterResults', 'suggestedCodeBlocks', 'editTrailContexts', 'allThinkingBlocks']) {
      if (Array.isArray(obj[k]) && obj[k].length > 0) {
        console.log(`\n>>> ${k} (前 2 条) <<<`);
        for (const item of obj[k].slice(0, 2)) {
          console.log(JSON.stringify(item, null, 2).slice(0, 3000));
          console.log('---');
        }
      }
    }
  } catch (err) {
    console.log(`解析失败: ${err}`);
  }
}

dump('thinking', withThinking);
dump('toolResults', withToolResults);
dump('interpreterResults', withInterpreter);
dump('suggestedCodeBlocks', withCodeBlock);
dump('allThinkingBlocks', withAllThinking);
dump('editTrailContexts', withEdit);

db.close();