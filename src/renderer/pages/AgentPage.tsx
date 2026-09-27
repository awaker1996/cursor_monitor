import { useCallback, useEffect, useRef, useState } from 'react';
import AgentTimeline from '../components/AgentTimeline';
import ErrorHint from '../components/ErrorHint';
import type { AgentTrace, AgentTraceErrorCode } from '../../shared/agentTrace';

const ERROR_MESSAGE: Record<AgentTraceErrorCode, { tone: 'info' | 'warn' | 'error'; text: string }> = {
  NOT_INSTALLED: {
    tone: 'info',
    text: '未检测到本地 Cursor 数据目录，请确认 Cursor 已安装并至少打开过一次',
  },
  LOCKED: {
    tone: 'warn',
    text: 'Cursor 正在写入数据，读取失败；稍后会重试，可关闭 Cursor 后再试一次',
  },
  SCHEMA_UNKNOWN: {
    tone: 'error',
    text: '能读取到本地数据库，但当前 schema 不在已知列表内，请展开下方调试折叠查看命中的表与字段',
  },
  NO_DATA: {
    tone: 'info',
    text: '尚未检测到本地智能体会话；请在 Cursor 中打开 Composer 发起一次对话',
  },
  INTERNAL: {
    tone: 'error',
    text: '读取本地智能体数据时发生未分类异常',
  },
};

function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

function summarizeDb(meta: AgentTrace['meta']): string {
  if (meta.dbKind === 'workspace' && meta.workspaceUri) return meta.workspaceUri;
  if (meta.dbKind === 'global') return '（全局）';
  return meta.dbPath;
}

export default function AgentPage() {
  const [trace, setTrace] = useState<AgentTrace | null>(null);
  const [paused, setPaused] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const initRef = useRef(false);
  const pausedRef = useRef(false);

  // 启动 watcher 并立即拉一次
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    let cancelled = false;
    void (async () => {
      setRefreshing(true);
      const initial = await window.electronAPI.agentGetLatestTrace();
      if (!cancelled) {
        setTrace(initial);
        setRefreshing(false);
      }
    })();
    void window.electronAPI.agentStartWatch();
    const unsub = window.electronAPI.onAgentTraceUpdated((next) => {
      if (cancelled) return;
      if (pausedRef.current) return;
      setTrace(next);
    });
    return () => {
      cancelled = true;
      unsub();
      void window.electronAPI.agentStopWatch();
    };
  }, []);

  // 同步 pausedRef，避免在回调里读陈旧值
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const handleManualRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await window.electronAPI.agentGetLatestTrace();
      setTrace(next);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const handleCopyDiagnostics = useCallback(async () => {
    if (!trace) return;
    const lines = [
      `dbPath: ${trace.meta.dbPath}`,
      `dbKind: ${trace.meta.dbKind}`,
      `workspaceUri: ${trace.meta.workspaceUri ?? '(null)'}`,
      `schemaTables: ${(trace.meta.schemaTableNames ?? []).join(', ') || '(none)'}`,
      `parseWarning: ${trace.meta.parseWarning ?? '(none)'}`,
      `error: ${trace.meta.error ? `${trace.meta.error.code} ${trace.meta.error.message}` : '(none)'}`,
      `turns: ${trace.turns.length}`,
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
    } catch {
      // clipboard 权限被拒时不弹提示，保持静默
    }
  }, [trace]);

  const errorEntry = trace?.meta.error ?? null;
  const errorInfo = errorEntry ? ERROR_MESSAGE[errorEntry.code] : null;
  const lastTurnTs = trace?.turns.length
    ? trace.turns[trace.turns.length - 1].timestampMs
    : null;

  return (
    <div className="page-shell page-shell--agent">
      <header className="page-shell__header">
        <div className="page-shell__title-wrap">
          <h1>智能体</h1>
          <p className="page-shell__subtitle">
            监听本地 Cursor 智能体（Composer / Agent）的思考链路与工具调用
          </p>
        </div>
        <div className="page-shell__actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setPaused((v) => !v)}
          >
            {paused ? '继续轮询' : '暂停轮询'}
          </button>
          <button
            type="button"
            className="btn-primary btn-primary--compact"
            onClick={handleManualRefresh}
            disabled={refreshing}
          >
            {refreshing ? '重新探测中…' : '重新探测'}
          </button>
        </div>
      </header>

      <div className="page-shell__meta">
        <span className="page-shell__meta-left">
          {trace ? summarizeDb(trace.meta) : '等待主进程返回数据…'}
        </span>
        <span className="page-shell__meta-right">
          {trace
            ? `更新于 ${formatTime(trace.meta.fetchedAtMs)} · ${paused ? '已暂停' : '2s 轮询'}`
            : '—'}
        </span>
      </div>

      {errorInfo && (
        <ErrorHint tone={errorInfo.tone} message={`${errorInfo.text}（${errorEntry?.message ?? ''}）`} />
      )}

      {!errorEntry && trace && trace.turns.length === 0 && (
        <ErrorHint
          tone="info"
          message="数据库中暂未识别到智能体 turn；请确认 Cursor 里有 Composer 对话记录"
        />
      )}

      {trace && trace.meta.parseWarning && (
        <ErrorHint
          tone="warn"
          message={`解析告警：${trace.meta.parseWarning}`}
        />
      )}

      {trace && (
        <section className="agent-debug">
          <button
            type="button"
            className="agent-debug__toggle"
            aria-expanded={showDebug}
            onClick={() => setShowDebug((v) => !v)}
          >
            <span>调试信息</span>
            <span className="agent-debug__chevron">{showDebug ? '▴' : '▾'}</span>
          </button>
          {showDebug && (
            <div className="agent-debug__body">
              <div className="agent-debug__row">
                <span className="agent-debug__label">数据库路径</span>
                <code className="agent-debug__value">{trace.meta.dbPath || '—'}</code>
              </div>
              <div className="agent-debug__row">
                <span className="agent-debug__label">数据库类型</span>
                <code className="agent-debug__value">{trace.meta.dbKind}</code>
              </div>
              <div className="agent-debug__row">
                <span className="agent-debug__label">命中表</span>
                <code className="agent-debug__value">
                  {(trace.meta.schemaTableNames ?? []).join(', ') || '—'}
                </code>
              </div>
              <div className="agent-debug__row">
                <span className="agent-debug__label">最近 turn 时间</span>
                <code className="agent-debug__value">
                  {lastTurnTs ? formatTime(lastTurnTs) : '—'}
                </code>
              </div>
              <div className="agent-debug__row">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleCopyDiagnostics}
                >
                  复制诊断信息
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <div className="page-shell__body">
        <div className="page-shell__content">
          {trace && <AgentTimeline turns={trace.turns} />}
          {!trace && (
            <div className="page-shell__loading">
              <p>加载中…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}