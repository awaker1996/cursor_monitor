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
const INTERACTIVE_SELECTOR =
  '.floating-ball__orb-wrap, .floating-ball__orb, .floating-ball__panel-frame, .floating-ball__panel';

function IconRefresh() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M13.5 8A5.5 5.5 0 1 1 8 2.5" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06" />
    </svg>
  );
}

function healthColor(
  snapshot: TokenSnapshot | null,
  pollerState: PollerState | null,
  isRefreshing: boolean,
): string {
  if (isRefreshing) return 'blue';
  if (!snapshot) return 'gray';
  if (snapshot.stale || pollerState?.status === 'backoff') return 'yellow';
  if (pollerState?.status === 'paused') return 'blue';
  return 'green';
}

function healthLabel(
  snapshot: TokenSnapshot | null,
  pollerState: PollerState | null,
  isRefreshing: boolean,
): string {
  if (isRefreshing) return '刷新中';
  if (!snapshot) return '无数据';
  if (snapshot.stale) return '缓存数据';
  if (pollerState?.status === 'backoff') return '退避中';
  if (pollerState?.status === 'paused') return '已暂停';
  return '正常';
}

type PanelView = 'overview' | 'included';
type PanelPhase = 'hidden' | 'entering' | 'shown' | 'leaving';

export default function App() {
  const [expanded, setExpanded] = useState(false);
  const [panelPhase, setPanelPhase] = useState<PanelPhase>('hidden');
  const [panelAnimOpen, setPanelAnimOpen] = useState(false);
  const [dockedEdge, setDockedEdge] = useState<DockEdge | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [snapshot, setSnapshot] = useState<TokenSnapshot | null>(null);
  const [pollerState, setPollerState] = useState<PollerState | null>(null);
  const [pendingRefresh, setPendingRefresh] = useState(false);
  const [panelView, setPanelView] = useState<PanelView>('overview');
  const draggingRef = useRef(false);
  const dragMovedRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const grabOffsetRef = useRef({ x: 0, y: 0 });
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
    setPanelPhase((phase) => (phase === 'hidden' || phase === 'leaving' ? phase : 'leaving'));
  }, []);

  const expandPanel = useCallback(() => {
    setExpanded(true);
    setPanelPhase('entering');
  }, []);

  const handlePanelTransitionEnd = useCallback((event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== 'opacity' && event.propertyName !== 'transform') return;

    setPanelPhase((phase) => {
      if (phase === 'entering') return 'shown';
      if (phase === 'leaving') {
        setExpanded(false);
        return 'hidden';
      }
      return phase;
    });
  }, []);

  const isRefreshing = pendingRefresh || (pollerState?.fetching ?? false);

  const handleManualRefresh = useCallback(() => {
    if (pendingRefresh || pollerState?.fetching) return;
    setPendingRefresh(true);
    void window.electronAPI.manualRefresh().finally(() => setPendingRefresh(false));
  }, [pendingRefresh, pollerState?.fetching]);

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
      if (edge) {
        setExpanded(false);
        setPanelAnimOpen(false);
        setPanelPhase('hidden');
      }
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
    setIsDragging(true);
    dragMovedRef.current = false;
    toggleOnReleaseRef.current = toggleOnRelease;
    dragStartRef.current = { x: e.screenX, y: e.screenY };
    const orb = (e.currentTarget as HTMLElement).closest('.floating-ball__orb');
    if (orb) {
      const rect = orb.getBoundingClientRect();
      grabOffsetRef.current = {
        x: e.clientX - (rect.left + rect.width / 2),
        y: e.clientY - (rect.top + rect.height / 2),
      };
    } else {
      grabOffsetRef.current = { x: 0, y: 0 };
    }
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
        window.electronAPI.moveWindow(dx, dy, grabOffsetRef.current);
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
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsDragging(false);
        });
      });
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
  const showIncludedTab = includedUsageDisplay !== null;

  useEffect(() => {
    if (!showIncludedTab && panelView === 'included') {
      setPanelView('overview');
    }
  }, [showIncludedTab, panelView]);

  useEffect(() => {
    if (panelPhase === 'entering') {
      setPanelAnimOpen(false);
      const frameId = requestAnimationFrame(() => {
        requestAnimationFrame(() => setPanelAnimOpen(true));
      });
      return () => cancelAnimationFrame(frameId);
    }
    if (panelPhase === 'shown') {
      setPanelAnimOpen(true);
      return;
    }
    if (panelPhase === 'leaving') {
      setPanelAnimOpen(false);
      return;
    }
    setPanelAnimOpen(false);
  }, [panelPhase]);
  const health = healthColor(snapshot, pollerState, isRefreshing);
  const statusLabel = healthLabel(snapshot, pollerState, isRefreshing);
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
  const orbMotionClass =
    snapshot?.stale || pollerState?.status === 'backoff' || pollerState?.status === 'paused'
      ? 'floating-ball__orb--motion-muted'
      : '';

  const dockClass = dockedEdge ? `floating-ball--docked-${dockedEdge}` : '';

  const orbNode = (
    <div className="floating-ball__orb-wrap">
      <div
        className={`floating-ball__orb floating-ball__orb--health-${health} ${orbMotionClass}`}
        style={orbRingStyle}
        onMouseDown={(e) => startDrag(e, true)}
        aria-label={dockedEdge ? '点击或拖出以恢复' : undefined}
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
    <div
      className={`floating-ball ${expanded ? 'floating-ball--expanded' : ''} ${dockClass}${isDragging ? ' floating-ball--dragging' : ''}`}
    >
      {orbNode}

      {panelPhase !== 'hidden' && (
        <div
          className={`floating-ball__panel-frame${panelAnimOpen ? ' floating-ball__panel-frame--open' : ''}${isRefreshing ? ' floating-ball__panel-frame--refreshing' : ''}`}
          onTransitionEnd={handlePanelTransitionEnd}
        >
          <div
            className={`floating-ball__panel no-drag${panelView === 'included' ? ' floating-ball__panel--included' : ''}`}
          >
            {isRefreshing && (
              <div className="floating-ball__refresh-track" aria-hidden>
                <div className="floating-ball__refresh-bar" />
              </div>
            )}
            <div
              className="floating-ball__panel-header floating-ball__drag-handle"
              onMouseDown={(e) => startDrag(e, false)}
            >
              <span>Cursor 用量监控</span>
              <div className="floating-ball__header-actions no-drag">
                <button
                  type="button"
                  className={`btn-icon btn-icon--toolbar${isRefreshing ? ' btn-icon--spinning' : ''}`}
                  aria-label="刷新"
                  title={isRefreshing ? '刷新中…' : '刷新'}
                  aria-busy={isRefreshing}
                  disabled={isRefreshing}
                  onClick={handleManualRefresh}
                >
                  <IconRefresh />
                </button>
                <button
                  type="button"
                  className="btn-icon btn-icon--toolbar"
                  aria-label="设置"
                  title="设置"
                  onClick={() => window.electronAPI.openSettings()}
                >
                  <IconSettings />
                </button>
                <button
                  type="button"
                  className="btn-icon btn-icon--toolbar btn-icon--close"
                  aria-label="收起"
                  title="收起"
                  onClick={collapsePanel}
                >
                  ×
                </button>
              </div>
            </div>

            <div className="floating-ball__panel-body">
              {panelView === 'overview' ? (
                <>
                  {snapshot && dashboardSummary ? (
                    <>
                      <div
                        className={`dashboard-summary dashboard-summary--${dashboardSummary.statusLevel}${isRefreshing ? ' dashboard-summary--refreshing' : ''}`}
                      >
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
                            <span className="meta-time__label">{isRefreshing ? '状态' : '上次刷新'}</span>
                            <span className="meta-time__value">
                              {isRefreshing ? '刷新中…' : dashboardSummary.updatedAt}
                            </span>
                          </span>
                        </div>
                      </div>

                      <div className="metric-list">
                        {metricItems.map((item) => (
                          <MetricRow key={item.key} item={item} />
                        ))}
                      </div>
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
                </>
              ) : (
                includedUsageDisplay && <IncludedUsageTable display={includedUsageDisplay} />
              )}
            </div>

            {showIncludedTab && (
              <div className="panel-view-switch" role="tablist" aria-label="面板视图">
                <button
                  type="button"
                  role="tab"
                  className={`panel-view-switch__tab${panelView === 'overview' ? ' panel-view-switch__tab--active' : ''}`}
                  aria-selected={panelView === 'overview'}
                  onClick={() => setPanelView('overview')}
                >
                  概览
                </button>
                <button
                  type="button"
                  role="tab"
                  className={`panel-view-switch__tab${panelView === 'included' ? ' panel-view-switch__tab--active' : ''}`}
                  aria-selected={panelView === 'included'}
                  onClick={() => setPanelView('included')}
                >
                  用量
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
