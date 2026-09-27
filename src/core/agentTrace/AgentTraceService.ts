import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createLogger } from '../../utils/logger';
import type {
  AgentTrace,
  AgentTraceError,
  AgentTraceMeta,
} from '../../shared/agentTrace';
import {
  CURSOR_KV_TABLE,
  detectCursorKvTable,
  listComposerRows,
} from './cursorSchema';
import { parseLatestBubbleFallback, parseLatestTrace } from './parser';

const log = createLogger('AgentTrace');

/**
 * 把本地 Cursor 智能体（Composer / Agent）trace 暴露给渲染层的服务。
 *
 * 唯一数据源：`%APPDATA%/Cursor/User/{globalStorage,workspaceStorage/<id>}/state.vscdb`，
 * 仅以 readonly 方式打开，避免与 Cursor 写锁冲突。
 *
 * 失败语义：
 *   NOT_INSTALLED — 没有任何 state.vscdb 可读
 *   LOCKED        — better-sqlite3 抛 SQLITE_BUSY / SQLITE_CORRUPT
 *   SCHEMA_UNKNOWN — 能读行但解析不出 turn（Cursor schema 变动）
 *   NO_DATA       — 解析成功但空 turn（用户还没发起过 Composer 对话）
 *   INTERNAL      — 未分类异常
 */

export interface AgentTraceServiceOptions {
  /** 用户 %APPDATA% 根路径，例如 `C:\Users\xxx\AppData\Roaming`。 */
  appDataDir: string;
  /** 调试日志钩子。默认 console。 */
  logger?: typeof log;
}

interface DbCandidate {
  path: string;
  kind: 'global' | 'workspace';
  workspaceUri?: string;
}

interface OpenDbHandle {
  db: Database.Database;
  path: string;
  kind: 'global' | 'workspace';
  workspaceUri?: string;
  /** 最近一次成功解析的 fingerprint。 */
  lastSignature: string;
}

export class AgentTraceService {
  private readonly appDataDir: string;
  private readonly logger: typeof log;
  private handle: OpenDbHandle | null = null;
  /** 2s 一次轮询；由 startWatch 启动。 */
  private interval: NodeJS.Timeout | null = null;
  private watchers: Set<(trace: AgentTrace) => void> = new Set();
  private lastEmitted: AgentTrace | null = null;
  private errorStreak = 0;
  private currentErrorCode: AgentTraceError['code'] | null = null;

  constructor(options: AgentTraceServiceOptions) {
    this.appDataDir = options.appDataDir;
    this.logger = options.logger ?? log;
  }

  /** 列出所有候选 state.vscdb 路径（按 mtime 倒序）。 */
  private resolveCandidates(): DbCandidate[] {
    const out: DbCandidate[] = [];

    // global
    const globalPath = path.join(this.appDataDir, 'Cursor', 'User', 'globalStorage', 'state.vscdb');
    if (fs.existsSync(globalPath)) {
      out.push({ path: globalPath, kind: 'global' });
    }

    // workspaces
    const workspacesRoot = path.join(this.appDataDir, 'Cursor', 'User', 'workspaceStorage');
    if (fs.existsSync(workspacesRoot)) {
      const entries = fs
        .readdirSync(workspacesRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory());
      const candidates: { candidate: DbCandidate; mtime: number }[] = [];
      for (const entry of entries) {
        const wsPath = path.join(workspacesRoot, entry.name, 'state.vscdb');
        if (!fs.existsSync(wsPath)) continue;
        try {
          const stat = fs.statSync(wsPath);
          const workspaceJson = path.join(workspacesRoot, entry.name, 'workspace.json');
          let workspaceUri: string | undefined;
          if (fs.existsSync(workspaceJson)) {
            try {
              const raw = JSON.parse(fs.readFileSync(workspaceJson, 'utf-8')) as {
                workspace?: { uri?: string };
              };
              workspaceUri = raw.workspace?.uri;
            } catch {
              // ignore malformed workspace.json
            }
          }
          candidates.push({
            candidate: { path: wsPath, kind: 'workspace', workspaceUri },
            mtime: stat.mtimeMs,
          });
        } catch {
          // skip unreadable workspace
        }
      }
      candidates.sort((a, b) => b.mtime - a.mtime);
      out.push(...candidates.slice(0, 5).map((c) => c.candidate));
    }

    return out;
  }

  private openHandle(candidate: DbCandidate): OpenDbHandle {
    const db = new Database(candidate.path, {
      readonly: true,
      fileMustExist: true,
    });
    return {
      db,
      path: candidate.path,
      kind: candidate.kind,
      workspaceUri: candidate.workspaceUri,
      lastSignature: '',
    };
  }

  private disposeHandle(): void {
    if (!this.handle) return;
    try {
      this.handle.db.close();
    } catch (err) {
      this.logger.warn('Failed to close state.vscdb handle', { error: String(err) });
    }
    this.handle = null;
  }

  /**
   * 拉取一次最新 trace。内部 catch 所有异常并归一化为 AgentTraceError。
   */
  async fetchLatest(): Promise<AgentTrace> {
    try {
      return await this.fetchLatestInternal();
    } catch (err) {
      const code = this.classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      const meta = this.lastEmitted?.meta ?? null;
      const trace: AgentTrace = {
        meta: {
          dbPath: meta?.dbPath ?? '',
          dbKind: meta?.dbKind ?? 'global',
          workspaceUri: meta?.workspaceUri ?? null,
          fetchedAtMs: Date.now(),
          error: { code, message },
        },
        turns: this.lastEmitted?.turns ?? [],
      };
      this.bumpErrorStreak(code);
      this.lastEmitted = trace;
      return trace;
    }
  }

  private async fetchLatestInternal(): Promise<AgentTrace> {
    const candidates = this.resolveCandidates();
    if (candidates.length === 0) {
      throw this.makeError('NOT_INSTALLED', '未检测到本地 Cursor 数据目录');
    }

    const preferred = this.pickPreferredCandidate(candidates);
    if (!this.handle || this.handle.path !== preferred.path) {
      this.disposeHandle();
      try {
        this.handle = this.openHandle(preferred);
      } catch (err) {
        throw this.makeError('LOCKED', `打开 ${preferred.path} 失败：${String(err)}`);
      }
    }
    const handle = this.handle;

    if (!detectCursorKvTable(handle.db)) {
      throw this.makeError('SCHEMA_UNKNOWN', '当前 SQLite 不包含 cursorDiskKV 表');
    }

    // 主路径：解析最近一个有效 composer
    let parsed = parseLatestTrace(handle.db);
    if (parsed.turns.length === 0) {
      // 退化：抓最近一个有内容的 bubble
      parsed = parseLatestBubbleFallback(handle.db);
    }

    if (parsed.turns.length === 0) {
      // 数据库能读但没数据
      const totalComposers = countComposerRows(handle.db);
      if (totalComposers === 0) {
        throw this.makeError(
          'NO_DATA',
          'cursorDiskKV 内无 composerData 行；请在 Cursor 中打开 Composer 发起一次对话',
        );
      }
      throw this.makeError(
        'SCHEMA_UNKNOWN',
        `找到 ${totalComposers} 条 composerData，但没有任何可解析 bubble 内容`,
      );
    }

    this.errorStreak = 0;
    this.currentErrorCode = null;

    const signature = signatureOfTrace(parsed, handle);
    handle.lastSignature = signature;

    const meta: AgentTraceMeta = {
      dbPath: handle.path,
      dbKind: handle.kind,
      workspaceUri: handle.workspaceUri ?? null,
      fetchedAtMs: Date.now(),
      parseWarning:
        parsed.warnings.length > 0 ? parsed.warnings.join('；') : undefined,
      schemaTableNames: [CURSOR_KV_TABLE],
    };

    const trace: AgentTrace = { meta, turns: parsed.turns };
    return trace;
  }

  private pickPreferredCandidate(candidates: DbCandidate[]): DbCandidate {
    if (this.handle) {
      const hit = candidates.find((c) => c.path === this.handle!.path);
      if (hit) return hit;
    }
    return candidates[0];
  }

  private classifyError(err: unknown): AgentTraceError['code'] {
    if (err instanceof AgentTraceServiceError) return err.code;
    const msg = err instanceof Error ? err.message : String(err);
    if (/SQLITE_BUSY|database is locked|database is closed/i.test(msg)) return 'LOCKED';
    if (/SQLITE_CORRUPT|file is not a database/i.test(msg)) return 'LOCKED';
    if (/SQLITE_READONLY|attempt to write a readonly database/i.test(msg)) return 'LOCKED';
    return 'INTERNAL';
  }

  private makeError(code: AgentTraceError['code'], message: string): AgentTraceServiceError {
    return new AgentTraceServiceError(code, message);
  }

  private bumpErrorStreak(code: AgentTraceError['code']): void {
    if (this.currentErrorCode === code) {
      this.errorStreak += 1;
    } else {
      this.currentErrorCode = code;
      this.errorStreak = 1;
    }
  }

  isInErrorBackoff(): boolean {
    return this.errorStreak >= 5;
  }

  isWatching(): boolean {
    return this.interval !== null;
  }

  subscribe(callback: (trace: AgentTrace) => void): () => void {
    this.watchers.add(callback);
    return () => {
      this.watchers.delete(callback);
    };
  }

  startWatch(intervalMs = 2000): void {
    if (this.interval) return;
    const tick = async () => {
      const trace = await this.fetchLatest();
      // 仅在 signature 变化时推送
      const sig = signatureOfFull(trace);
      if (this.lastEmitted && signatureOfFull(this.lastEmitted) === sig) {
        return;
      }
      this.lastEmitted = trace;
      for (const cb of this.watchers) {
        try {
          cb(trace);
        } catch (err) {
          this.logger.warn('Watcher threw', { error: String(err) });
        }
      }
    };
    void tick();
    const period = this.isInErrorBackoff() ? 30_000 : intervalMs;
    this.interval = setInterval(() => {
      void tick();
    }, period);
  }

  stopWatch(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  dispose(): void {
    this.stopWatch();
    this.watchers.clear();
    this.disposeHandle();
  }
}

export class AgentTraceServiceError extends Error {
  public readonly code: AgentTraceError['code'];
  constructor(code: AgentTraceError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'AgentTraceServiceError';
  }
}

function countComposerRows(db: Database.Database): number {
  try {
    return listComposerRows(db).length;
  } catch {
    return 0;
  }
}

function signatureOfTrace(
  parsed: ReturnType<typeof parseLatestTrace>,
  handle: OpenDbHandle,
): string {
  const lastTs =
    parsed.turns.length > 0 ? parsed.turns[parsed.turns.length - 1].timestampMs ?? 0 : 0;
  return `${handle.path}|${parsed.composerId}|${parsed.turns.length}|${lastTs}`;
}

function signatureOfFull(trace: AgentTrace): string {
  const lastTs =
    trace.turns.length > 0 ? trace.turns[trace.turns.length - 1].timestampMs ?? 0 : 0;
  return `${trace.meta.dbPath}|${trace.turns.length}|${trace.meta.error?.code ?? 'ok'}|${lastTs}`;
}

export function openInMemoryDatabase(): Database.Database {
  return new Database(':memory:');
}

export type { Database };