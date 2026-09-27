/**
 * 在本地 state.vscdb 上做一次只读 schema 探测，列出所有表名 + 命中
 * 我启发式条件的表，便于排查「智能体」Tab 没有内容的问题。
 *
 * 运行：npx tsx scripts/inspect-cursor-schema.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

function listAppDataRoots(): string[] {
  const appData = process.env.APPDATA ?? '';
  const home = process.env.USERPROFILE ?? '';
  return [
    path.join(appData, 'Cursor'),
    path.join(home, 'AppData', 'Roaming', 'Cursor'),
  ];
}

function listCandidates(): { path: string; kind: string; mtime: number }[] {
  const candidates: { path: string; kind: string; mtime: number }[] = [];
  for (const root of listAppDataRoots()) {
    const globalDb = path.join(root, 'User', 'globalStorage', 'state.vscdb');
    if (fs.existsSync(globalDb)) {
      candidates.push({
        path: globalDb,
        kind: 'global',
        mtime: fs.statSync(globalDb).mtimeMs,
      });
    }
    const wsRoot = path.join(root, 'User', 'workspaceStorage');
    if (fs.existsSync(wsRoot)) {
      for (const entry of fs.readdirSync(wsRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const wsDb = path.join(wsRoot, entry.name, 'state.vscdb');
        if (!fs.existsSync(wsDb)) continue;
        candidates.push({
          path: wsDb,
          kind: 'workspace',
          mtime: fs.statSync(wsDb).mtimeMs,
        });
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates;
}

const KNOWN = [
  'composerData',
  'cursorDiskKV',
  'ItemTable',
  'bubble',
  'bubbles',
  'Bubble',
  'agentConversation',
  'agentData',
  'composer',
  'conversations',
  'conversation',
  'composer_bubble',
  'composer_session',
  'chat_history',
  'agent_history',
];

function inspectDb(dbPath: string, kind: string): void {
  console.log(`\n===== ${kind.toUpperCase()} ${dbPath} =====`);
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    console.log(`  打开失败: ${err}`);
    return;
  }
  try {
    const allNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    console.log(`  共 ${allNames.length} 张表`);

    // 启发式命中
    const lc = new Set(allNames.map((t) => t.name.toLowerCase()));
    const hits = KNOWN.filter((k) => lc.has(k.toLowerCase()));
    console.log(`  已知 composer 关键字命中: ${hits.join(', ') || '(无)'}`);

    // 启发式字段：表内含 toolcall/bubbleid/composerid/lastupdatedat 等
    const candidateTables: { name: string; columns: string[] }[] = [];
    for (const t of allNames) {
      const cols = db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all() as { name: string }[];
      const colNames = cols.map((c) => c.name.toLowerCase());
      const has =
        colNames.some((c) => c.includes('toolcall') || c.includes('tool_call')) ||
        colNames.some((c) => c.includes('bubbleid') || c.includes('bubble_id')) ||
        colNames.some((c) => c === 'composerid' || c === 'composer_id') ||
        colNames.some((c) => c === 'lastupdatedat' || c === 'last_updated_at') ||
        (colNames.some((c) => c === 'role') && colNames.some((cc) => cc.includes('text')));
      if (has) candidateTables.push({ name: t.name, columns: colNames });
    }
    console.log(`  启发式字段命中: ${candidateTables.map((c) => c.name).join(', ') || '(无)'}`);

    // 全表打印列名（便于发现新 schema）
    console.log(`  全部表（前 30 列宽限制）：`);
    for (const t of allNames) {
      const cols = db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all() as { name: string }[];
      const colNames = cols.map((c) => c.name);
      console.log(`    - ${t.name}  (${cols.length} 列): ${colNames.slice(0, 20).join(', ')}${colNames.length > 20 ? ', ...' : ''}`);
    }
  } catch (err) {
    console.log(`  schema 探测失败: ${err}`);
  } finally {
    try {
      db.close();
    } catch {
      // ignore
    }
  }
}

const candidates = listCandidates();
if (candidates.length === 0) {
  console.log('未发现任何 state.vscdb');
  process.exit(1);
}

console.log(`候选 db 共 ${candidates.length} 个：`);
for (const c of candidates.slice(0, 6)) {
  console.log(`  [${c.kind}] ${c.path} (mtime=${new Date(c.mtime).toISOString()})`);
}

for (const c of candidates.slice(0, 6)) {
  inspectDb(c.path, c.kind);
}