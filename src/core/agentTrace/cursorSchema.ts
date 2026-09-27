import type Database from 'better-sqlite3';

/**
 * Cursor 内部 SQLite（state.vscdb）的实际形态（v3 schema）：
 *
 *   - 只有一张有效数据表：`cursorDiskKV`（key, value），
 *     全部 Composer / Bubble / Agent / Ofs 内容都在这张表里按 key 前缀组织。
 *   - `ItemTable` 是 VSCode 工作区 KV，与 Composer 无关。
 *   - `composerHeaders` 在本机实测是空表（Cursor 已废弃 / 改名 / 走 cursorDiskKV）。
 *
 * 关键 key 前缀：
 *
 *   `composerData:<composerId>`         Composer 主记录：含 name、lastUpdatedAt、
 *                                       fullConversationHeadersOnly[]、conversationMap{}、
 *                                       capabilities[]、text、context 等。
 *   `bubbleId:<composerId>:<bubbleId>` 单条 bubble：type(1=user, 2=ai)、text、thinking{text,signature}、
 *                                       toolResults[]、suggestedCodeBlocks[]、
 *                                       interpreterResults[]、editTrailContexts[]、
 *                                       tokenCount、modelInfo、createdAt 等。
 *   `ofsContent:<bubbleId>:<fileURI>`   Agent 用 read_file 读到的文件内容快照。
 *   `codeBlockPartialInlineDiffFates:<bubbleId>:<fileURI>`
 *                                       Agent 编辑文件的 diff fate（accepted/rejected）。
 *   `task-tool_<id>` / `task-call_<id>`Composer 内部 sub-agent / 任务委派，不是用户级
 *                                       Composer，需要排除。
 *
 * 本文件只暴露读 + 探测 API；turn 归一化逻辑在 parser.ts。
 */

export interface KvRow {
  key: string;
  value: unknown;
}

const KEY_PREFIX_COMPOSER = 'composerData:';
const KEY_PREFIX_BUBBLE = 'bubbleId:';
const KEY_PREFIX_OFS_CONTENT = 'ofsContent:';
const KEY_PREFIX_DIFF_FATES = 'codeBlockPartialInlineDiffFates:';

const SUB_AGENT_PREFIXES = ['task-tool_', 'task-call_'];

/** 用于 SELECT：cursorDiskKV 表上拉 key/value。 */
export const CURSOR_KV_TABLE = 'cursorDiskKV';

/** 安全拼出限定的 key pattern。SQLite 的 LIKE 不区分大小写。 */
function likeKey(prefix: string): string {
  return `${prefix}%`;
}

/** 取出所有 `composerData:<id>` 行，按 lastUpdatedAt DESC。返回原始 JSON 解析后的对象。 */
export function listComposerRows(db: Database.Database): KvRow[] {
  const rows = db
    .prepare(`SELECT key, value FROM ${CURSOR_KV_TABLE} WHERE key LIKE ?`)
    .all(likeKey(KEY_PREFIX_COMPOSER)) as { key: string; value: string }[];
  const out: KvRow[] = [];
  for (const r of rows) {
    try {
      out.push({ key: r.key, value: JSON.parse(r.value) });
    } catch {
      // 忽略坏行
    }
  }
  return out;
}

/** 取出某个 composer 下的所有 bubbleId 行（按 key 升序）。 */
export function listBubbleRows(
  db: Database.Database,
  composerId: string,
): KvRow[] {
  const prefix = `${KEY_PREFIX_BUBBLE}${composerId}:`;
  const rows = db
    .prepare(
      `SELECT key, value FROM ${CURSOR_KV_TABLE} WHERE key LIKE ?`,
    )
    .all(likeKey(prefix)) as { key: string; value: string }[];
  const out: KvRow[] = [];
  for (const r of rows) {
    try {
      out.push({ key: r.key, value: JSON.parse(r.value) });
    } catch {
      // ignore
    }
  }
  return out;
}

/** 取出某个 bubble 的 ofsContent（read_file 结果）侧表行。 */
export function listOfsContentRows(
  db: Database.Database,
  bubbleId: string,
): KvRow[] {
  const prefix = `${KEY_PREFIX_OFS_CONTENT}${bubbleId}:`;
  const rows = db
    .prepare(
      `SELECT key, value FROM ${CURSOR_KV_TABLE} WHERE key LIKE ?`,
    )
    .all(likeKey(prefix)) as { key: string; value: string }[];
  const out: KvRow[] = [];
  for (const r of rows) {
    try {
      out.push({ key: r.key, value: JSON.parse(r.value) });
    } catch {
      // ofsContent 可能是纯文本（content 字段），不强求 JSON
      out.push({ key: r.key, value: r.value });
    }
  }
  return out;
}

/** 取出某个 bubble 的 diff fate 行（编辑工具结果）。 */
export function listDiffFateRows(
  db: Database.Database,
  bubbleId: string,
): KvRow[] {
  const prefix = `${KEY_PREFIX_DIFF_FATES}${bubbleId}:`;
  const rows = db
    .prepare(
      `SELECT key, value FROM ${CURSOR_KV_TABLE} WHERE key LIKE ?`,
    )
    .all(likeKey(prefix)) as { key: string; value: string }[];
  const out: KvRow[] = [];
  for (const r of rows) {
    try {
      out.push({ key: r.key, value: JSON.parse(r.value) });
    } catch {
      out.push({ key: r.key, value: r.value });
    }
  }
  return out;
}

/** 给定 composerId，从 key 里提取出真实 bubbleId（去掉前缀）。 */
export function bubbleIdFromKey(composerId: string, key: string): string | null {
  const prefix = `${KEY_PREFIX_BUBBLE}${composerId}:`;
  if (!key.startsWith(prefix)) return null;
  return key.slice(prefix.length);
}

/** 给定 composerData 行，看是否属于 sub-agent（task-tool_ / task-call_）。 */
export function isSubAgentComposer(composerKey: string): boolean {
  const id = composerKey.startsWith(KEY_PREFIX_COMPOSER)
    ? composerKey.slice(KEY_PREFIX_COMPOSER.length)
    : composerKey;
  return SUB_AGENT_PREFIXES.some((p) => id.startsWith(p));
}

/** 从 composerData 行里取 lastUpdatedAt（毫秒）。 */
export function readLastUpdatedAt(row: KvRow): number {
  const v = row.value as { lastUpdatedAt?: number } | null;
  if (!v || typeof v.lastUpdatedAt !== 'number') return 0;
  return v.lastUpdatedAt;
}

/** 从 composerData 行里取 fullConversationHeadersOnly[].bubbleId 顺序。 */
export function readHeaderOrder(row: KvRow): string[] {
  const v = row.value as { fullConversationHeadersOnly?: unknown } | null;
  if (!v || !Array.isArray(v.fullConversationHeadersOnly)) return [];
  const out: string[] = [];
  for (const h of v.fullConversationHeadersOnly) {
    if (h && typeof h === 'object' && 'bubbleId' in h && typeof (h as { bubbleId: unknown }).bubbleId === 'string') {
      out.push((h as { bubbleId: string }).bubbleId);
    }
  }
  return out;
}

/** 从 composerData 行里取 name（用于 UI 调试折叠 / 标题展示）。 */
export function readComposerName(row: KvRow): string {
  const v = row.value as { name?: unknown } | null;
  return typeof v?.name === 'string' ? v.name : '';
}

/** 把 ofsContent 行里的 fileURI 提取出来。key 形如 ofsContent:<bubbleId>:<fileURI>。 */
export function fileUriFromOfsKey(bubbleId: string, key: string): string {
  const prefix = `${KEY_PREFIX_OFS_CONTENT}${bubbleId}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : '';
}

/** 把 diff fate key 里的 fileURI 提取出来。key 形如 codeBlockPartialInlineDiffFates:<bubbleId>:<fileURI>。 */
export function fileUriFromDiffKey(bubbleId: string, key: string): string {
  const prefix = `${KEY_PREFIX_DIFF_FATES}${bubbleId}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : '';
}

export {
  KEY_PREFIX_COMPOSER,
  KEY_PREFIX_BUBBLE,
  KEY_PREFIX_OFS_CONTENT,
  KEY_PREFIX_DIFF_FATES,
};

/** Schema 探测：当前 DB 是否为 Cursor state.vscdb 且包含 composerDiskKV 表。 */
export function detectCursorKvTable(db: Database.Database): boolean {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    )
    .all(CURSOR_KV_TABLE) as { name: string }[];
  return rows.length > 0;
}