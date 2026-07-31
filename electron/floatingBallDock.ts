import { BrowserWindow, screen } from 'electron';
import type { DockEdge } from '../src/shared/types';
import {
  ORB_EXPANDED_HEIGHT,
  ORB_PANEL_WIDTH,
  ORB_WINDOW_HEIGHT,
  ORB_DOCK_HIDE_OFFSET,
  ORB_WRAP_MARGIN,
  ORB_VISUAL_SIZE,
  enforceFloatingBallWidth,
} from './windows/floatingBall';

export const DOCK_THRESHOLD = 24;
/** When two edges are within threshold and this close, prefer left/right over top/bottom. */
export const CORNER_DOCK_TIE = 8;
export const PEEK_TAB_WIDTH = 32;
export const PEEK_TAB_LENGTH = 72;
export const ORB_WINDOW_PADDING = 12;
export const ORB_ANCHOR_SIZE = 80;
export const UNDOCK_DRAG = 4;

/** @deprecated use PEEK_TAB_WIDTH */
export const PEEK_SIZE = PEEK_TAB_WIDTH;

interface DockState {
  docked: boolean;
  edge: DockEdge | null;
  savedBounds: Electron.Rectangle | null;
}

const dockState: DockState = {
  docked: false,
  edge: null,
  savedBounds: null,
};

export function getDockState(): { docked: boolean; edge: DockEdge | null } {
  return { docked: dockState.docked, edge: dockState.edge };
}

export function clearDockState(): void {
  dockState.docked = false;
  dockState.edge = null;
  dockState.savedBounds = null;
}

function getOrbAnchorRect(bounds: Electron.Rectangle): Electron.Rectangle {
  // Anchor tracks the visible orb (bottom-right of window), not the full window box.
  const size = Math.max(ORB_ANCHOR_SIZE, ORB_VISUAL_SIZE);
  const orbRight = bounds.x + bounds.width - ORB_WINDOW_PADDING - ORB_WRAP_MARGIN;
  const orbBottom = bounds.y + bounds.height - ORB_WINDOW_PADDING - ORB_WRAP_MARGIN;
  return {
    x: orbRight - size,
    y: orbBottom - size,
    width: size,
    height: size,
  };
}

function getOrbCenterInWindow(
  docked: boolean,
  edge: DockEdge | null,
  expanded: boolean,
): { x: number; y: number } {
  const height = expanded ? ORB_EXPANDED_HEIGHT : ORB_WINDOW_HEIGHT;
  const pad = ORB_WINDOW_PADDING;
  const wrap = docked ? 0 : ORB_WRAP_MARGIN;
  const hide = docked ? ORB_DOCK_HIDE_OFFSET : 0;
  const half = ORB_VISUAL_SIZE / 2;

  if (docked && edge === 'top') {
    return {
      x: ORB_PANEL_WIDTH - pad - half,
      y: pad - hide + half,
    };
  }

  if (docked && edge === 'left') {
    return {
      x: pad - hide + half,
      y: height - pad - half,
    };
  }

  if (docked && edge === 'right') {
    return {
      x: ORB_PANEL_WIDTH - pad + hide - half,
      y: height - pad - half,
    };
  }

  if (docked && edge === 'bottom') {
    return {
      x: ORB_PANEL_WIDTH - pad - half,
      y: height - pad + hide - half,
    };
  }

  // Undocked — orb sits bottom-right with wrap margin.
  return {
    x: ORB_PANEL_WIDTH - pad - wrap - half,
    y: height - pad - wrap - half,
  };
}

function computeInPlaceUndockBounds(
  _bounds: Electron.Rectangle,
  _edge: DockEdge,
  delta: UndockDragDelta,
): Electron.Rectangle {
  const grabX = delta.grabOffsetX ?? 0;
  const grabY = delta.grabOffsetY ?? 0;
  // Full undocked layout immediately — no deferred expand on mouseup.
  const to = getOrbCenterInWindow(false, null, true);

  return {
    x: Math.round(delta.cursorX - to.x - grabX),
    y: Math.round(delta.cursorY - to.y - grabY),
    width: ORB_PANEL_WIDTH,
    height: ORB_EXPANDED_HEIGHT,
  };
}

function getWorkAreaForPoint(point: Electron.Point): Electron.Rectangle {
  return screen.getDisplayNearestPoint(point).workArea;
}

function distToEdges(
  rect: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Record<DockEdge, number> {
  return {
    left: Math.max(0, rect.x - workArea.x),
    right: Math.max(0, workArea.x + workArea.width - (rect.x + rect.width)),
    top: Math.max(0, rect.y - workArea.y),
    bottom: Math.max(0, workArea.y + workArea.height - (rect.y + rect.height)),
  };
}

function getDockedWindowBounds(
  edge: DockEdge,
  currentBounds: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Electron.Rectangle {
  const from = getOrbCenterInWindow(false, null, true);
  const to = getOrbCenterInWindow(true, edge, false);
  const ballScreenX = currentBounds.x + from.x;
  const ballScreenY = currentBounds.y + from.y;

  const next: Electron.Rectangle = {
    x: Math.round(ballScreenX - to.x),
    y: Math.round(ballScreenY - to.y),
    width: ORB_PANEL_WIDTH,
    height: ORB_WINDOW_HEIGHT,
  };

  const hide = ORB_DOCK_HIDE_OFFSET;
  switch (edge) {
    case 'right':
      next.x = workArea.x + workArea.width - ORB_PANEL_WIDTH + hide;
      break;
    case 'left':
      next.x = workArea.x - hide;
      break;
    case 'bottom':
      next.y = workArea.y + workArea.height - ORB_WINDOW_HEIGHT + hide;
      break;
    case 'top':
      next.y = workArea.y - hide;
      break;
  }

  return next;
}

export function tryDockWindow(win: BrowserWindow, enabled: boolean): DockEdge | null {
  if (!enabled || win.isDestroyed()) {
    if (dockState.docked) {
      undockWindow(win);
    } else {
      dockState.docked = false;
      dockState.edge = null;
      dockState.savedBounds = null;
    }
    return null;
  }

  const bounds = win.getBounds();
  const anchor = getOrbAnchorRect(bounds);
  const anchorCenter = {
    x: anchor.x + anchor.width / 2,
    y: anchor.y + anchor.height / 2,
  };
  const cursor = screen.getCursorScreenPoint();
  const refPoint = {
    x: (anchorCenter.x + cursor.x) / 2,
    y: (anchorCenter.y + cursor.y) / 2,
  };
  const workArea = getWorkAreaForPoint(refPoint);
  const dists = distToEdges(anchor, workArea);

  const edges: DockEdge[] = ['left', 'right', 'top', 'bottom'];
  let nearest: DockEdge = 'right';
  let minDist = dists.right;
  for (const edge of edges) {
    if (dists[edge] < minDist) {
      minDist = dists[edge];
      nearest = edge;
    }
  }

  if (minDist <= DOCK_THRESHOLD) {
    const horiz: DockEdge[] = ['left', 'right'];
    const vert: DockEdge[] = ['top', 'bottom'];
    const horizIn = horiz.filter((e) => dists[e] <= DOCK_THRESHOLD);
    const vertIn = vert.filter((e) => dists[e] <= DOCK_THRESHOLD);
    if (horizIn.length > 0 && vertIn.length > 0) {
      const bestH = horizIn.reduce((a, b) => (dists[a] <= dists[b] ? a : b));
      const bestV = vertIn.reduce((a, b) => (dists[a] <= dists[b] ? a : b));
      if (Math.abs(dists[bestH] - dists[bestV]) <= CORNER_DOCK_TIE) {
        nearest = bestH;
        minDist = dists[bestH];
      }
    }
  }

  if (minDist > DOCK_THRESHOLD) {
    dockState.docked = false;
    dockState.edge = null;
    dockState.savedBounds = null;
    return null;
  }

  if (!dockState.docked) {
    dockState.savedBounds = bounds;
  }

  const next = getDockedWindowBounds(nearest, bounds, workArea);

  win.setBounds({
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: ORB_PANEL_WIDTH,
    height: ORB_WINDOW_HEIGHT,
  });
  enforceFloatingBallWidth(win);

  dockState.docked = true;
  dockState.edge = nearest;
  return nearest;
}

export type UndockMode = 'restore' | 'inPlace';

export interface UndockDragDelta {
  dx?: number;
  dy?: number;
  cursorX: number;
  cursorY: number;
  grabOffsetX?: number;
  grabOffsetY?: number;
}

export function undockWindow(
  win: BrowserWindow,
  mode: UndockMode = 'restore',
  delta?: UndockDragDelta,
): void {
  if (!dockState.docked || win.isDestroyed()) return;

  const edge = dockState.edge;
  const saved = dockState.savedBounds;
  const bounds = win.getBounds();

  let next: Electron.Rectangle;

  if (mode === 'inPlace' && edge && delta) {
    next = computeInPlaceUndockBounds(bounds, edge, delta);
  } else if (saved) {
    next = {
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width: ORB_PANEL_WIDTH,
      height: ORB_EXPANDED_HEIGHT,
    };
  } else {
    const heightDelta = ORB_EXPANDED_HEIGHT - bounds.height;
    next = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y - heightDelta),
      width: ORB_PANEL_WIDTH,
      height: ORB_EXPANDED_HEIGHT,
    };
  }

  win.setBounds(next);
  enforceFloatingBallWidth(win);

  dockState.docked = false;
  dockState.edge = null;
  dockState.savedBounds = null;
}

export function handleMoveWhileDocked(
  win: BrowserWindow,
  dx: number,
  dy: number,
  grabOffset?: { x: number; y: number },
): boolean {
  if (!dockState.docked || !dockState.edge || win.isDestroyed()) return false;

  const edge = dockState.edge;
  let shouldUndock = false;

  switch (edge) {
    case 'right':
      shouldUndock = dx < -UNDOCK_DRAG;
      break;
    case 'left':
      shouldUndock = dx > UNDOCK_DRAG;
      break;
    case 'bottom':
      shouldUndock = dy < -UNDOCK_DRAG;
      break;
    case 'top':
      shouldUndock = dy > UNDOCK_DRAG;
      break;
  }

  if (shouldUndock) {
    const cursor = screen.getCursorScreenPoint();
    undockWindow(win, 'inPlace', {
      cursorX: cursor.x,
      cursorY: cursor.y,
      grabOffsetX: grabOffset?.x ?? 0,
      grabOffsetY: grabOffset?.y ?? 0,
      dx,
      dy,
    });
    return true;
  }
  return false;
}
