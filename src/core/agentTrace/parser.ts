import type Database from 'better-sqlite3';
import type { AgentTurn } from '../../shared/agentTrace';
import {
  CURSOR_KV_TABLE,
  bubbleIdFromKey,
  detectCursorKvTable,
  fileUriFromDiffKey,
  fileUriFromOfsKey,
  isSubAgentComposer,
  listBubbleRows,
  listComposerRows,
  listDiffFateRows,
  listOfsContentRows,
  readComposerName,
  readHeaderOrder,
  readLastUpdatedAt,
  type KvRow,
} from './cursorSchema';

/**
 * 把 cursorDiskKV 里的 composer / bubble / ofsContent / diffFate 数据
 * 归一化成 AgentTurn[]。
 *
 * 解析流程：
 *   1. 拉所有 composerData:<id> 行
 *   2. 跳过 sub-agent（task-tool_*, task-call_*），按 lastUpdatedAt DESC 排序
 *   3. 选最近一个有 fullConversationHeadersOnly 且 bubbleId 数量 > 0 的
 *   4. 按 fullConversationHeadersOnly 顺序读 bubbleId:<composerId>:<bubbleId>
 *   5. 每条 bubble：
 *        type=1（用户） → user turn
 *        type=2（AI）   → thinking.text → thinking turn
 *                       → text → assistant turn
 *                       → 关联 ofsContent:* → read_file tool_call + tool_result
 *                       → 关联 codeBlockPartialInlineDiffFates:* → edit_file tool_call + tool_result
 *   6. 如果选中的 composer 没有任何 bubble 数据，再退到子表查询最近一个含
 *      thinking / text 的 bubble
 */

export interface ParsedTrace {
  composerId: string;
  composerName: string;
  lastUpdatedAt: number;
  turns: AgentTurn[];
  warnings: string[];
}

const TOOL_FILE_READ = 'read_file';
const TOOL_FILE_EDIT = 'edit_file';

function safeStringify(value: unknown, max = 4000): string | undefined {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > max ? `${text.slice(0, max)}…（已截断）` : text;
  } catch {
    return undefined;
  }
}

function clipText(text: string, max = 8000): string {
  return text.length > max ? `${text.slice(0, max)}…（已截断）` : text;
}

/** 把 bubble 里的 text / thinking 字段抽取成 turn 列表。 */
function bubbleToTurns(bubble: KvRow, indexBase: number): AgentTurn[] {
  const v = bubble.value as Record<string, unknown> | null;
  if (!v) return [];

  const type = typeof v.type === 'number' ? v.type : 0;
  const text = typeof v.text === 'string' ? v.text : '';
  const createdAt = typeof v.createdAt === 'string' ? v.createdAt : null;
  const timestampMs = createdAt ? new Date(createdAt).getTime() : null;
  const validTs = timestampMs !== null && Number.isFinite(timestampMs) ? timestampMs : null;

  const out: AgentTurn[] = [];
  let idx = indexBase;

  if (type === 1) {
    if (text.trim()) {
      out.push({
        index: idx++,
        type: 'user',
        text: clipText(text),
        timestampMs: validTs,
      });
    }
    return out;
  }

  if (type === 2) {
    // 1. thinking
    const thinking = v.thinking as { text?: unknown } | null;
    if (thinking && typeof thinking.text === 'string' && thinking.text.trim()) {
      out.push({
        index: idx++,
        type: 'thinking',
        text: clipText(thinking.text),
        timestampMs: validTs,
      });
    }
    // 2. 最终回复
    if (text.trim()) {
      out.push({
        index: idx++,
        type: 'assistant',
        text: clipText(text),
        timestampMs: validTs,
      });
    }
    return out;
  }

  return out;
}

/** 把 ofsContent 行转成 read_file tool_call + tool_result。 */
function ofsContentToTurns(
  rows: KvRow[],
  bubbleId: string,
  indexBase: number,
): AgentTurn[] {
  const out: AgentTurn[] = [];
  let idx = indexBase;
  for (const row of rows) {
    const uri = fileUriFromOfsKey(bubbleId, row.key);
    const value = row.value as { content?: unknown } | string | null;
    let body = '';
    if (value && typeof value === 'object' && typeof (value as { content: unknown }).content === 'string') {
      body = (value as { content: string }).content;
    } else if (typeof value === 'string') {
      body = value;
    }
    if (!uri && !body) continue;

    out.push({
      index: idx++,
      type: 'tool_call',
      text: `${TOOL_FILE_READ} ${uri || '(未知文件)'}`,
      payload: safeStringify({ file: uri }, 400),
      timestampMs: null,
    });
    if (body) {
      out.push({
        index: idx++,
        type: 'tool_result',
        text: clipText(body, 4000),
        payload: safeStringify({ file: uri, byteLength: body.length }, 400),
        timestampMs: null,
      });
    }
  }
  return out;
}

/** 把 diff fate 行转成 edit_file tool_call + tool_result。 */
function diffFatesToTurns(
  rows: KvRow[],
  bubbleId: string,
  indexBase: number,
): AgentTurn[] {
  const out: AgentTurn[] = [];
  let idx = indexBase;
  for (const row of rows) {
    const uri = fileUriFromDiffKey(bubbleId, row.key);
    const v = row.value as { fates?: unknown } | null;
    const fates = v && Array.isArray(v.fates) ? v.fates : [];
    if (!uri && fates.length === 0) continue;

    const acceptedCount = fates.filter(
      (f) => (f as { fate?: string })?.fate === 'accepted',
    ).length;

    out.push({
      index: idx++,
      type: 'tool_call',
      text: `${TOOL_FILE_EDIT} ${uri || '(未知文件)'}`,
      payload: safeStringify({ file: uri }, 400),
      timestampMs: null,
    });
    out.push({
      index: idx++,
      type: 'tool_result',
      text: `共 ${fates.length} 处改动（accepted=${acceptedCount}）`,
      payload: safeStringify({ file: uri, fates }, 4000),
      timestampMs: null,
    });
  }
  return out;
}

/** 把 turn 重新分配连续 index。 */
function renumberTurns(turns: AgentTurn[]): AgentTurn[] {
  return turns.map((t, i) => ({ ...t, index: i }));
}

export function parseLatestTrace(db: Database.Database): ParsedTrace {
  const warnings: string[] = [];

  if (!detectCursorKvTable(db)) {
    return {
      composerId: '',
      composerName: '',
      lastUpdatedAt: 0,
      turns: [],
      warnings: ['当前 SQLite 不包含 cursorDiskKV 表，不是 Cursor state.vscdb'],
    };
  }

  // 1. 全部 composerData 行
  const composerRows = listComposerRows(db)
    .filter((r) => !isSubAgentComposer(r.key))
    .sort((a, b) => readLastUpdatedAt(b) - readLastUpdatedAt(a));

  if (composerRows.length === 0) {
    warnings.push('cursorDiskKV 内无 composerData 行');
    return { composerId: '', composerName: '', lastUpdatedAt: 0, turns: [], warnings };
  }

  // 2. 优先选有 fullConversationHeadersOnly 且长度 > 0 的最近一个
  let selectedComposer: KvRow | null = null;
  for (const row of composerRows) {
    if (readHeaderOrder(row).length > 0) {
      selectedComposer = row;
      break;
    }
  }
  // 退化：选最近一个有 lastUpdatedAt 的 creator
  if (!selectedComposer) selectedComposer = composerRows[0];

  const composerId = selectedComposer.key.replace(/^composerData:/, '');
  const composerName = readComposerName(selectedComposer);
  const lastUpdatedAt = readLastUpdatedAt(selectedComposer);

  const headerOrder = readHeaderOrder(selectedComposer);
  if (headerOrder.length === 0) {
    warnings.push(`composer ${composerId} 无 fullConversationHeadersOnly`);
    return { composerId, composerName, lastUpdatedAt, turns: [], warnings };
  }

  // 3. 把 bubbleId 索引准备好
  const bubbleMap = new Map<string, KvRow>();
  for (const b of listBubbleRows(db, composerId)) {
    const bid = bubbleIdFromKey(composerId, b.key);
    if (bid) bubbleMap.set(bid, b);
  }

  // 4. 顺序解析
  const allTurns: AgentTurn[] = [];
  let idx = 0;
  for (const bid of headerOrder) {
    const bubble = bubbleMap.get(bid);
    if (!bubble) {
      // bubble 行缺失，保留一个提示 turn
      allTurns.push({
        index: idx++,
        type: 'assistant',
        text: `（bubble ${bid} 数据缺失，已被清理）`,
        timestampMs: null,
      });
      continue;
    }
    const bubbleTurns = bubbleToTurns(bubble, idx);
    idx += bubbleTurns.length;
    allTurns.push(...bubbleTurns);

    // 关联工具调用
    const ofsRows = listOfsContentRows(db, bid);
    if (ofsRows.length > 0) {
      const turns = ofsContentToTurns(ofsRows, bid, idx);
      idx += turns.length;
      allTurns.push(...turns);
    }
    const diffRows = listDiffFateRows(db, bid);
    if (diffRows.length > 0) {
      const turns = diffFatesToTurns(diffRows, bid, idx);
      idx += turns.length;
      allTurns.push(...turns);
    }
  }

  if (allTurns.length === 0) {
    warnings.push(`composer ${composerId} 的 ${headerOrder.length} 个 bubble 都没有可解析内容`);
  }

  return {
    composerId,
    composerName,
    lastUpdatedAt,
    turns: renumberTurns(allTurns),
    warnings,
  };
}

export { bubbleToTurns, ofsContentToTurns, diffFatesToTurns, renumberTurns };

/** 在 composer 不存在 / bubbles 全空时，回退到「最近含 thinking 的 bubble」模式。 */
export function parseLatestBubbleFallback(db: Database.Database): ParsedTrace {
  const warnings: string[] = [];
  if (!detectCursorKvTable(db)) {
    return {
      composerId: '',
      composerName: '',
      lastUpdatedAt: 0,
      turns: [],
      warnings: ['当前 SQLite 不包含 cursorDiskKV 表'],
    };
  }

  // 找到最近一个 type=2 且 thinking.text 非空的 bubble
  const allBubbleRows = db
    .prepare(
      `SELECT key, value FROM ${CURSOR_KV_TABLE} WHERE key LIKE ?`,
    )
    .all('bubbleId:%') as { key: string; value: string }[];

  let bestRow: { key: string; value: string; createdAt: number } | null = null;
  for (const r of allBubbleRows) {
    try {
      const v = JSON.parse(r.value) as {
        type?: number;
        createdAt?: string;
        thinking?: { text?: string };
        text?: string;
      };
      const createdAt = v.createdAt ? new Date(v.createdAt).getTime() : 0;
      const meaningful =
        (v.type === 2 && ((v.thinking && v.thinking.text) || v.text)) ||
        (v.type === 1 && v.text);
      if (!meaningful) continue;
      if (!bestRow || createdAt > bestRow.createdAt) {
        bestRow = { key: r.key, value: r.value, createdAt };
      }
    } catch {
      // ignore
    }
  }

  if (!bestRow) {
    warnings.push('cursorDiskKV 内无任何有意义的 bubble');
    return { composerId: '', composerName: '', lastUpdatedAt: 0, turns: [], warnings };
  }

  const bubble = { key: bestRow.key, value: JSON.parse(bestRow.value) as unknown };
  const composerId = bubble.key.includes(':')
    ? bubble.key.split(':')[1]
    : '';
  const turns = renumberTurns(bubbleToTurns(bubble, 0));
  return {
    composerId,
    composerName: '',
    lastUpdatedAt: bestRow.createdAt,
    turns,
    warnings,
  };
}