/**
 * 跑真实 parser，限制只看最近 composer 的前 20 个 bubble + 关联的 ofsContent/diffFates。
 * 这是真实使用中最关键的部分；剩下 bubble 在轮询时陆续展开即可。
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  bubbleIdFromKey,
  listBubbleRows,
  listComposerRows,
  listDiffFateRows,
  listOfsContentRows,
  readHeaderOrder,
  readLastUpdatedAt,
  isSubAgentComposer,
} from '../src/core/agentTrace/cursorSchema';
import { bubbleToTurns, ofsContentToTurns, diffFatesToTurns } from '../src/core/agentTrace/parser';

const dbPath = path.join(
  process.env.APPDATA ?? '',
  'Cursor',
  'User',
  'globalStorage',
  'state.vscdb',
);
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const composers = listComposerRows(db)
  .filter((r) => !isSubAgentComposer(r.key))
  .sort((a, b) => readLastUpdatedAt(b) - readLastUpdatedAt(a));
const top = composers[0];
const composerId = top.key.replace(/^composerData:/, '');
console.log(`最近 composer: ${composerId}  name='${(top.value as { name?: string }).name}'`);

const headerOrder = readHeaderOrder(top);
console.log(`fcho 长度: ${headerOrder.length}`);
console.log(`前 20 个 bubbleId:`);
for (const b of headerOrder.slice(0, 20)) console.log(`  ${b}`);

// 取前 20 个 bubble
const allBubbles = listBubbleRows(db, composerId);
console.log(`总 bubble 行数: ${allBubbles.length}`);
const bubbleMap = new Map<string, typeof allBubbles[number]>();
for (const b of allBubbles) {
  const bid = bubbleIdFromKey(composerId, b.key);
  if (bid) bubbleMap.set(bid, b);
}

const turns: ReturnType<typeof bubbleToTurns>[number][] = [];
let idx = 0;
for (const bid of headerOrder.slice(0, 20)) {
  const b = bubbleMap.get(bid);
  if (b) {
    const bt = bubbleToTurns(b, idx);
    idx += bt.length;
    turns.push(...bt);
  }
  // 查 ofsContent
  const ofs = listOfsContentRows(db, bid);
  if (ofs.length > 0) {
    const ot = ofsContentToTurns(ofs, bid, idx);
    idx += ot.length;
    turns.push(...ot);
  }
  // 查 diffFates
  const diffs = listDiffFateRows(db, bid);
  if (diffs.length > 0) {
    const dt = diffFatesToTurns(diffs, bid, idx);
    idx += dt.length;
    turns.push(...dt);
  }
}

console.log(`\n展开 ${headerOrder.slice(0, 20).length} 个 bubble → ${turns.length} 个 turn`);
console.log('\n所有 turn：');
for (const t of turns) {
  const ts = t.timestampMs ? new Date(t.timestampMs).toISOString().slice(11, 19) : '—';
  console.log(`  [${String(t.index).padStart(2)}] ${t.type.padEnd(11)} ts=${ts}  ${t.text.slice(0, 100).replace(/\n/g, ' ')}`);
}

const types = turns.reduce<Record<string, number>>((acc, t) => {
  acc[t.type] = (acc[t.type] || 0) + 1;
  return acc;
}, {});
console.log('\n按类型：', types);

db.close();