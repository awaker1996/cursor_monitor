import { useCallback, useEffect, useRef, useState } from 'react';
import MetricRow from './components/MetricRow';
import IncludedUsageTable from './components/IncludedUsageTable';
import ErrorHint from './components/ErrorHint';
import {
  buildDashboardSummary,
  buildIncludedUsageDisplay,
  buildMetricItems,
  formatOrbSummary,
} from '../shared/format';
import type { PollerState, TokenSnapshot, DockEdge } from '../shared/types';

const DRAG_THRESHOLD = 4;
const ORB_RING_RADIUS = 24;
const ORB_RING_CIRCUMFERENCE = 2 * Math.PI * ORB_RING_RADIUS;
const PEEK_RING_RADIUS = 10;
const PEEK_RING_CIRCUMFERENCE = 2 * Math.PI * PEEK_RING_RADIUS;
const PEEK_RING_CENTER = 12;
const INTERACTIVE_SELECTOR =
  '.floating-ball__orb-wrap, .floating-ball__orb, .floating-ball__panel, .floating-ball__peek';

function healthColor(snapshot: TokenSnapshot | null, pollerState: PollerState | null): string {
  if (!snapshot) return 'gray';
  if (snapshot.stale || pollerState?.status === 'backoff') return 'yellow';
  if (pollerState?.status === 'paused') return 'blue';
  return 'green';
}

function healthLabel(snapshot: TokenSnapshot | null, pollerState: PollerState | null): string {
  if (!snapshot) return '无数据';
  if (snapshot.stale) return '缓存数据';
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
  const expandedRef = useRef(false);
  const mousePassthroughRef = useRef(true);

  useEffect(() => {
    dockedEdgeRef.current = dockedEdge;
  }, [dockedEdge]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const collapsePanel = useCallback(() => {
    setExpanded(false);
  }, []);

  const expandPanel = useCallback(() => {
    setExpanded(true);
  }, []);

  const setMousePassthrough = useCallback((ignore: boolean) => {
    if (draggingRef.current || expandedRef.current) {
      if (mousePassthroughRef.current !== false) {
        mousePassthroughRef.current = false;
        window.electronAPI.setIgnoreMouseEvents(false);
      }
      return;
    }
    if (mousePassthroughRef.current === ignore) return;
    mousePassthroughRef.current = ignore;
    window.electronAPI.setIgnoreMouseEvents(ignore);
  }, []);

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
    if (expanded) {
      window.electronAPI.setIgnoreMouseEvents(false);
      mousePassthroughRef.current = false;
      return;
    }

    const updateFromPoint = (clientX: number, clientY: number) => {
      if (draggingRef.current || expandedRef.current) {
        setMousePassthrough(false);
        return;
      }
      const el = document.elementFromPoint(clientX, clientY);
      const interactive = el?.closest(INTERACTIVE_SELECTOR);
      setMousePassthrough(!interactive);
    };

    // Default to clickable; only enable passthrough once cursor is in transparent area
    mousePassthroughRef.current = false;
    window.electronAPI.setIgnoreMouseEvents(false);

    const handleMouseMove = (e: MouseEvent) => {
      updateFromPoint(e.clientX, e.clientY);
    };

    const pollCursor = async () => {
      const point = await window.electronAPI.getCursorInWindow();
      if (point) updateFromPoint(point.x, point.y);
    };

    void pollCursor();

    window.addEventListener('mousemove', handleMouseMove);
    const pollTimer = window.setInterval(() => {
      void pollCursor();
    }, 80);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.clearInterval(pollTimer);
    };
  }, [dockedEdge, expanded, setMousePassthrough]);

  const startDrag = useCallback((e: React.MouseEvent, toggleOnRelease = false) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('.no-drag')) return;
    draggingRef.current = true;
    dragMovedRef.current = false;
    toggleOnReleaseRef.current = toggleOnRelease;
    dragStartRef.current = { x: e.screenX, y: e.screenY };
    window.electronAPI.setIgnoreMouseEvents(false);
    mousePassthroughRef.current = false;
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
        if (expandedRef.current) {
          collapsePanel();
        } else {
          expandPanel();
        }
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
  }, [collapsePanel, expandPanel]);

  const orbSummary = formatOrbSummary(snapshot);
  const dashboardSummary = buildDashboardSummary(snapshot);
  const includedUsageDisplay = buildIncludedUsageDisplay(snapshot);
  const metricItems = buildMetricItems(snapshot?.metrics);
  const health = healthColor(snapshot, pollerState);
  const statusLabel = healthLabel(snapshot, pollerState);
  const orbRingOffset =
    orbSummary.percentValue !== null
      ? ORB_RING_CIRCUMFERENCE * (1 - orbSummary.percentValue / 100)
      : ORB_RING_CIRCUMFERENCE;
  const orbPercent = orbSummary.percentValue ?? 0;
  const orbFilledLength = ORB_RING_CIRCUMFERENCE * (orbPercent / 100);
  const orbFlowSegment = Math.max(14, orbFilledLength * 0.35);
  const orbFlowTrailSegment = Math.max(10, orbFlowSegment * 0.55);
  const orbFlowFrom = orbRingOffset;
  const orbFlowTo = orbRingOffset - orbFilledLength + orbFlowSegment;
  const orbFlowDuration = 3.5 - orbPercent * 0.028;
  const orbCapRadius = 3 + orbPercent * 0.012;
  const orbRingStyle =
    orbSummary.percentValue !== null
      ? ({
          '--orb-percent': orbSummary.percentValue,
          '--orb-filled-length': orbFilledLength,
          '--orb-flow-segment': orbFlowSegment,
          '--orb-flow-trail-segment': orbFlowTrailSegment,
          '--orb-flow-from': orbFlowFrom,
          '--orb-flow-to': orbFlowTo,
          '--orb-flow-duration': `${orbFlowDuration}s`,
          '--orb-flow-trail-delay': `${orbFlowDuration * 0.35}s`,
          '--orb-ring-width': 3.5 + orbPercent * 0.02,
          '--orb-glow-opacity': 0.45 + orbPercent * 0.008,
        } as React.CSSProperties)
      : undefined;
  const orbRingCap =
    orbSummary.percentValue !== null && orbSummary.percentValue > 0
      ? {
          x:
            28 +
            ORB_RING_RADIUS *
              Math.cos((orbSummary.percentValue / 100) * 2 * Math.PI - Math.PI / 2),
          y:
            28 +
            ORB_RING_RADIUS *
              Math.sin((orbSummary.percentValue / 100) * 2 * Math.PI - Math.PI / 2),
        }
      : null;
  const peekRingOffset =
    orbSummary.percentValue !== null
      ? PEEK_RING_CIRCUMFERENCE * (1 - orbSummary.percentValue / 100)
      : PEEK_RING_CIRCUMFERENCE;
  const peekRingCap =
    orbSummary.percentValue !== null && orbSummary.percentValue > 0
      ? {
          x:
            PEEK_RING_CENTER +
            PEEK_RING_RADIUS *
              Math.cos((orbSummary.percentValue / 100) * 2 * Math.PI - Math.PI / 2),
          y:
            PEEK_RING_CENTER +
            PEEK_RING_RADIUS *
              Math.sin((orbSummary.percentValue / 100) * 2 * Math.PI - Math.PI / 2),
        }
      : null;
  const orbMotionClass =
    snapshot?.stale || pollerState?.status === 'backoff' || pollerState?.status === 'paused'
      ? 'floating-ball__orb--motion-muted'
      : '';

  const dockClass = dockedEdge ? `floating-ball--docked-${dockedEdge}` : '';

  const peekTab = dockedEdge ? (
    <div className="floating-ball__orb-wrap">
      <div
        className={`floating-ball__peek floating-ball__peek--${dockedEdge} floating-ball__peek--health-${health}`}
        onMouseDown={(e) => startDrag(e, true)}
        aria-label="点击或拖出以恢复"
      >
        <div className="floating-ball__peek-shell">
          <div className="floating-ball__peek-body">
          <svg className="floating-ball__peek-ring" viewBox="0 0 24 24" aria-hidden>
            <circle
              className="floating-ball__peek-ring-track"
              cx={PEEK_RING_CENTER}
              cy={PEEK_RING_CENTER}
              r={PEEK_RING_RADIUS}
            />
            <circle
              className="floating-ball__peek-ring-progress"
              cx={PEEK_RING_CENTER}
              cy={PEEK_RING_CENTER}
              r={PEEK_RING_RADIUS}
              strokeDasharray={PEEK_RING_CIRCUMFERENCE}
              strokeDashoffset={peekRingOffset}
            />
            {peekRingCap && (
              <circle
                className="floating-ball__peek-ring-cap"
                cx={peekRingCap.x}
                cy={peekRingCap.y}
                r={2}
              />
            )}
          </svg>
          <span className="floating-ball__peek-value">{orbSummary.value}</span>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="floating-ball__orb-wrap">
      <div
        className={`floating-ball__orb floating-ball__orb--health-${health} ${orbMotionClass}`}
        style={orbRingStyle}
        onMouseDown={(e) => startDrag(e, true)}
      >
        <svg
          className="floating-ball__orb-ring"
          viewBox="0 0 56 56"
          aria-hidden
        >
          <defs>
            <clipPath id="orb-ring-clip">
              <circle
                cx="28"
                cy="28"
                r={ORB_RING_RADIUS}
                fill="none"
                stroke="white"
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={ORB_RING_CIRCUMFERENCE}
                strokeDashoffset={orbRingOffset}
              />
            </clipPath>
            <linearGradient
              id="orb-ring-fluid"
              gradientUnits="userSpaceOnUse"
              x1="28"
              y1="8"
              x2="28"
              y2="48"
            >
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
              <stop offset="35%" stopColor="currentColor" stopOpacity="1" />
              <stop offset="65%" stopColor="currentColor" stopOpacity="0.85" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0.25" />
              {!orbMotionClass && orbSummary.percentValue !== null && orbSummary.percentValue > 0 && (
                <animateTransform
                  attributeName="gradientTransform"
                  type="rotate"
                  from="0 28 28"
                  to="360 28 28"
                  dur={`${orbFlowDuration}s`}
                  repeatCount="indefinite"
                />
              )}
            </linearGradient>
          </defs>
          <circle
            className="floating-ball__orb-ring-track"
            cx="28"
            cy="28"
            r={ORB_RING_RADIUS}
          />
          {!orbMotionClass && orbSummary.percentValue !== null && orbSummary.percentValue > 0 && (
            <circle
              className="floating-ball__orb-ring-glow"
              cx="28"
              cy="28"
              r={ORB_RING_RADIUS}
              strokeDasharray={ORB_RING_CIRCUMFERENCE}
              strokeDashoffset={orbRingOffset}
            />
          )}
          <g clipPath="url(#orb-ring-clip)">
            <circle
              className="floating-ball__orb-ring-progress"
              cx="28"
              cy="28"
              r={ORB_RING_RADIUS}
              strokeDasharray={ORB_RING_CIRCUMFERENCE}
              strokeDashoffset={orbRingOffset}
            />
            {!orbMotionClass && orbSummary.percentValue !== null && orbSummary.percentValue > 0 && (
              <>
                <circle
                  className="floating-ball__orb-ring-flow-trail"
                  cx="28"
                  cy="28"
                  r={ORB_RING_RADIUS}
                  strokeDasharray={`${orbFlowTrailSegment} ${ORB_RING_CIRCUMFERENCE}`}
                  strokeDashoffset={orbFlowFrom}
                />
                <circle
                  className="floating-ball__orb-ring-flow"
                  cx="28"
                  cy="28"
                  r={ORB_RING_RADIUS}
                  strokeDasharray={`${orbFlowSegment} ${ORB_RING_CIRCUMFERENCE}`}
                  strokeDashoffset={orbFlowFrom}
                />
              </>
            )}
          </g>
          {orbRingCap && (
            <circle
              className="floating-ball__orb-ring-cap"
              cx={orbRingCap.x}
              cy={orbRingCap.y}
              r={orbCapRadius}
            />
          )}
        </svg>
        <div className="floating-ball__orb-core">
          <span className="floating-ball__total">
            <span className="floating-ball__total-label">{orbSummary.label}</span>
            <span className="floating-ball__total-value" key={orbSummary.value}>
              {orbSummary.value}
            </span>
          </span>
        </div>
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
            <button className="btn-icon no-drag" onClick={collapsePanel}>
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
                  message="当前展示的是缓存数据，可能不是最新"
                  action={`上次成功刷新：${new Date(snapshot.fetchedAt).toLocaleString('zh-CN')}。请检查网络或更新 Cookie`}
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

          {includedUsageDisplay && (
            <IncludedUsageTable display={includedUsageDisplay} />
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
