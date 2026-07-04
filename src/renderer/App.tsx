import { useCallback, useEffect, useRef, useState } from 'react';
import MetricRow from './components/MetricRow';
import ErrorHint from './components/ErrorHint';
import { buildDashboardSummary, buildMetricItems, formatOrbSummary } from '../shared/format';
import type { PollerState, TokenSnapshot, DockEdge } from '../shared/types';

const DRAG_THRESHOLD = 4;

function healthColor(snapshot: TokenSnapshot | null, pollerState: PollerState | null): string {
  if (!snapshot) return 'gray';
  if (snapshot.stale || pollerState?.status === 'backoff') return 'yellow';
  if (pollerState?.status === 'paused') return 'blue';
  return 'green';
}

function healthLabel(snapshot: TokenSnapshot | null, pollerState: PollerState | null): string {
  if (!snapshot) return '无数据';
  if (snapshot.stale) return '数据过期';
  if (pollerState?.status === 'backoff') return '退避中';
  if (pollerState?.status === 'paused') return '已暂停';
  return '正常';
}

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [dockedEdge, setDockedEdge] = useState<DockEdge | null>(null);
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [pollerState, setPollerState] = useState<PollerState | null>(null);
  const draggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const toggleOnReleaseRef = useRef(false);
  const dockedEdgeRef = useRef<DockEdge | null>(null);

  useEffect(() => {
    dockedEdgeRef.current = dockedEdge;
  }, [dockedEdge]);

  useEffect(() => {
    window.electronAPI.getSnapshot().then(setSnapshot);
    window.electronAPI.getPollerState().then(setPollerState);

    const unsub1 = window.electronAPI.onSnapshot(setSnapshot);
    const unsub2 = window.electronAPI.onPollerState(setPollerState);
    const unsub3 = window.electronAPI.onDockStateChanged((edge) => {
      setDockedEdge(edge);
      if (edge) setExpanded(false);
    });
    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, []);

  useEffect(() => {
    if (dockedEdge) return;
    window.electronAPI.setOrbMode(expanded ? 'expanded' : 'collapsed');
  }, [expanded, dockedEdge]);

  const startDrag = useCallback((e: React.MouseEvent, toggleOnRelease = false) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    draggingRef.current = true;
    dragMovedRef.current = false;
    toggleOnReleaseRef.current = toggleOnRelease;
    dragStartRef.current = { x: e.screenX, y: e.screenY };
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const dx = e.screenX - dragStartRef.current.x;
      const dy = e.screenY - dragStartRef.current.y;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragMovedRef.current = true;
        window.electronAPI.moveWindow(dx, dy);
        dragStartRef.current = { x: e.screenX, y: e.screenY };
      }
    };

    const handleUp = () => {
      if (!draggingRef.current) return;
      if (dockedEdgeRef.current && !dragMovedRef.current) {
        window.electronAPI.undockWindow();
      } else if (toggleOnReleaseRef.current && !dragMovedRef.current) {
        setExpanded((prev) => !prev);
      }
      if (dragMovedRef.current) {
        window.electronAPI.finishWindowMove();
      }
      draggingRef.current = false;
      dragMovedRef.current = false;
      toggleOnReleaseRef.current = false;
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const orbSummary = formatOrbSummary(snapshot);
  const dashboardSummary = buildDashboardSummary(snapshot);
  const metricItems = buildMetricItems(snapshot?.metrics);
  const health = healthColor(snapshot, pollerState);
  const statusLabel = healthLabel(snapshot, pollerState);

  const dockClass = dockedEdge ? `floating-ball--docked-${dockedEdge}` : '';

  const peekTab = dockedEdge ? (
    <div className="floating-ball__orb-wrap">
      <div
        className={`floating-ball__peek floating-ball__peek--${dockedEdge} floating-ball__peek--health-${health}`}
        onMouseDown={(e) => startDrag(e, true)}
        title="点击或拖出以恢复"
      >
        <span className={`floating-ball__peek-dot health-dot health-dot--${health}`} />
      </div>
    </div>
  ) : (
    <div className="floating-ball__orb-wrap">
      <div
        className="floating-ball__orb"
        onMouseDown={(e) => startDrag(e, true)}
      >
        <span className={`health-dot health-dot--${health}`} />
        <span className="floating-ball__total">
          <span className="floating-ball__total-label">{orbSummary.label}</span>
          <span className="floating-ball__total-value">{orbSummary.value}</span>
        </span>
      </div>
    </div>
  );

  return (
    <div className={`floating-ball ${expanded ? 'floating-ball--expanded' : ''} ${dockClass}`}>
      {peekTab}

      {expanded && (
        <div className="floating-ball__panel no-drag">
          <div
            className="floating-ball__panel-header floating-ball__drag-handle"
            onMouseDown={(e) => startDrag(e, false)}
          >
            <span>Cursor 用量</span>
            <button className="btn-icon no-drag" onClick={() => setExpanded(false)}>
              ×
            </button>
          </div>

          {snapshot && dashboardSummary ? (
            <>
              <div className={`dashboard-summary dashboard-summary--${dashboardSummary.statusLevel}`}>
                <div className="dashboard-summary__main">
                  <span className="dashboard-summary__label">总消耗</span>
                  <span className="dashboard-summary__value">{dashboardSummary.totalPercent}</span>
                </div>
                {dashboardSummary.totalPercentValue !== null && (
                  <div className="dashboard-summary__track" aria-hidden>
                    <div
                      className={`dashboard-summary__fill dashboard-summary__fill--${dashboardSummary.statusLevel}`}
                      style={{ width: `${dashboardSummary.totalPercentValue}%` }}
                    />
                  </div>
                )}
                <div className="dashboard-summary__detail">{dashboardSummary.totalTokens}</div>
                {dashboardSummary.billingPeriod && (
                  <div className="dashboard-summary__billing">
                    <span className="dashboard-summary__billing-label">账单周期</span>
                    <div className="dashboard-summary__billing-rows">
                      {dashboardSummary.billingPeriod.start && (
                        <div className="dashboard-summary__billing-row">
                          <span className="dashboard-summary__billing-tag">起</span>
                          <span className="dashboard-summary__billing-date">
                            {dashboardSummary.billingPeriod.start}
                          </span>
                        </div>
                      )}
                      {dashboardSummary.billingPeriod.end && (
                        <div className="dashboard-summary__billing-row">
                          <span className="dashboard-summary__billing-tag">止</span>
                          <span className="dashboard-summary__billing-date">
                            {dashboardSummary.billingPeriod.end}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="dashboard-summary__meta">
                  <span className={`health-pill health-pill--${health}`}>{statusLabel}</span>
                  <span className={`source-tag source-tag--${snapshot.source}`}>
                    {dashboardSummary.sourceLabel}
                  </span>
                  <span className="meta-time">
                    <span className="meta-time__label">上次刷新</span>
                    <span className="meta-time__value">{dashboardSummary.updatedAt}</span>
                  </span>
                </div>
              </div>

              <div className="metric-list">
                {metricItems.map((item) => (
                  <MetricRow key={item.key} item={item} />
                ))}
              </div>

              {snapshot.stale && (
                <ErrorHint
                  message="数据可能已过期"
                  action="请检查网络或更新 Cookie"
                />
              )}
            </>
          ) : (
            <ErrorHint
              message="暂无数据"
              action="请在设置中配置 Cookie 后刷新"
            />
          )}

          {pollerState?.status === 'backoff' && (
            <ErrorHint
              message={`退避等待中 (${Math.round((pollerState.backoffMs ?? 0) / 1000)}s)`}
            />
          )}

          {pollerState?.status === 'paused' && (
            <div className="status-banner status-banner--paused">自动刷新已暂停</div>
          )}

          <div className="floating-ball__actions">
            <button
              className="btn-sm"
              onClick={() => window.electronAPI.manualRefresh()}
            >
              刷新
            </button>
            <button
              className="btn-sm btn-sm--secondary"
              onClick={() => window.electronAPI.openSettings()}
            >
              设置
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
