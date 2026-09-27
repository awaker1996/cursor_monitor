/**
 * 逐个 composer 扫描，找出有 tool call / thinking / suggestedCodeBlocks 等
 * 实际数据的 composer，然后从第一个命中里 dump 出真实结构。
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

const TARGETS = [
  '4e2ec584-a6d0-47ed-9de3-a56a7bb64cb6',
  '2c8eba91-05c7-4594-b338-e6c8856a55c0',
  '5cb044c9-8f75-40f3-8009-f62f2bfd2f87',
  'aac69526-fa1c-4565-96f2-32eafe2c44ee',
  'bde6d75d-1842-4861-a1d3-f2c38b845a9c',
];

const FOUND: Record<string, { key: string; value: string } | null> = {
  thinking: null,
  toolResults: null,
  interpreterResults: null,
  suggestedCodeBlocks: null,
  editTrailContexts: null,
  allThinkingBlocks: null,
  tool: null,
  toolCall: null,
  tool_call: null,
};

for (const cid of TARGETS) {
  console.log(`\n--- 扫描 ${cid} ---`);
  const rows = db
    .prepare(`SELECT key, value FROM cursorDiskKV WHERE key LIKE ?`)
    .all(`bubbleId:${cid}:%`) as { key: string; value: string }[];
  console.log(`  共 ${rows.length} 条 bubble`);

  for (const r of rows) {
    if (r.value.length < 50) continue;
    if (!FOUND.thinking && r.value.includes('"thinking":{"text"')) FOUND.thinking = r;
    if (!FOUND.toolResults && r.value.includes('"toolResults":[{"')) FOUND.toolResults = r;
    if (!FOUND.interpreterResults && r.value.includes('"interpreterResults":[{"')) FOUND.interpreterResults = r;
    if (!FOUND.suggestedCodeBlocks && r.value.includes('"suggestedCodeBlocks":[{"')) FOUND.suggestedCodeBlocks = r;
    if (!FOUND.editTrailContexts && r.value.includes('"editTrailContexts":[{"')) FOUND.editTrailContexts = r;
    if (!FOUND.allThinkingBlocks && r.value.includes('"allThinkingBlocks":[{"')) FOUND.allThinkingBlocks = r;
    if (!FOUND.tool && /"tool"\s*:\s*\{/.test(r.value)) FOUND.tool = r;
    if (!FOUND.toolCall && r.value.includes('"toolCall":{')) FOUND.toolCall = r;
    if (!FOUND.tool_call && r.value.includes('"tool_call":{')) FOUND.tool_call = r;
    if (
      FOUND.thinking && FOUND.toolResults && FOUND.interpreterResults &&
      FOUND.suggestedCodeBlocks && FOUND.editTrailContexts &&
      FOUND.tool && FOUND.toolCall && FOUND.tool_call
    ) break;
  }
  console.log(`  进度: thinking=${!!FOUND.thinking} toolResults=${!!FOUND.toolResults} interp=${!!FOUND.interpreterResults} scb=${!!FOUND.suggestedCodeBlocks} edit=${!!FOUND.editTrailContexts} allThinking=${!!FOUND.allThinkingBlocks} tool=${!!FOUND.tool} toolCall=${!!FOUND.toolCall} tool_call=${!!FOUND.tool_call}`);

  if (
    FOUND.thinking && FOUND.toolResults && FOUND.interpreterResults &&
    FOUND.suggestedCodeBlocks && FOUND.editTrailContexts
  ) {
    console.log(`  在 ${cid} 找到全部关键字段，停止扫描`);
    break;
  }
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
    for (const k of ['tool', 'toolCall', 'tool_call', 'toolResults', 'interpreterResults', 'suggestedCodeBlocks', 'editTrailContexts', 'allThinkingBlocks']) {
      if (obj[k] !== undefined && obj[k] !== null) {
        console.log(`\n>>> ${k} <<<`);
        const text = JSON.stringify(obj[k], null, 2);
        console.log(text.slice(0, 3000));
      }
    }
  } catch (err) {
    console.log(`解析失败: ${err}`);
  }
}

dump('thinking', FOUND.thinking);
dump('toolResults', FOUND.toolResults);
dump('interpreterResults', FOUND.interpreterResults);
dump('suggestedCodeBlocks', FOUND.suggestedCodeBlocks);
dump('editTrailContexts', FOUND.editTrailContexts);
dump('tool field', FOUND.tool);
dump('toolCall field', FOUND.toolCall);
dump('tool_call field', FOUND.tool_call);

db.close();