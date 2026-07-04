import { BrowserWindow, screen } from 'electron';
import type { DockEdge } from '../src/shared/types';

export const DOCK_THRESHOLD = 24;
export const PEEK_TAB_WIDTH = 20;
export const PEEK_TAB_LENGTH = 56;
export const ORB_WINDOW_PADDING = 12;
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

function getWorkArea(win: BrowserWindow): Electron.Rectangle {
  return screen.getDisplayMatching(win.getBounds()).workArea;
}

function distToEdges(
  bounds: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Record<DockEdge, number> {
  return {
    left: bounds.x - workArea.x,
    right: workArea.x + workArea.width - (bounds.x + bounds.width),
    top: bounds.y - workArea.y,
    bottom: workArea.y + workArea.height - (bounds.y + bounds.height),
  };
}

function getOrbAnchorBounds(bounds: Electron.Rectangle): Electron.Rectangle {
  const collapsed = 80;
  if (bounds.width > collapsed || bounds.height > collapsed) {
    return {
      x: bounds.x + bounds.width - collapsed,
      y: bounds.y + bounds.height - collapsed,
      width: collapsed,
      height: collapsed,
    };
  }
  return bounds;
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
  const workArea = getWorkArea(win);
  const dists = distToEdges(bounds, workArea);

  const edges: DockEdge[] = ['left', 'right', 'top', 'bottom'];
  let nearest: DockEdge = 'right';
  let minDist = dists.right;
  for (const edge of edges) {
    if (dists[edge] < minDist) {
      minDist = dists[edge];
      nearest = edge;
    }
  }

  if (minDist > DOCK_THRESHOLD) {
    dockState.docked = false;
    dockState.edge = null;
    dockState.savedBounds = null;
    return null;
  }

  if (!dockState.docked) {
    dockState.savedBounds = getOrbAnchorBounds(bounds);
  }

  const saved = dockState.savedBounds ?? getOrbAnchorBounds(bounds);
  const next: Electron.Rectangle = { ...bounds };

  switch (nearest) {
    case 'right':
      next.width = PEEK_TAB_WIDTH;
      next.height = PEEK_TAB_LENGTH;
      next.x = workArea.x + workArea.width - PEEK_TAB_WIDTH;
      next.y = saved.y + saved.height - ORB_WINDOW_PADDING - PEEK_TAB_LENGTH;
      break;
    case 'left':
      next.width = PEEK_TAB_WIDTH;
      next.height = PEEK_TAB_LENGTH;
      next.x = workArea.x;
      next.y = saved.y + saved.height - ORB_WINDOW_PADDING - PEEK_TAB_LENGTH;
      break;
    case 'bottom':
      next.width = PEEK_TAB_LENGTH;
      next.height = PEEK_TAB_WIDTH;
      next.x = saved.x + saved.width - ORB_WINDOW_PADDING - PEEK_TAB_LENGTH;
      next.y = workArea.y + workArea.height - PEEK_TAB_WIDTH;
      break;
    case 'top':
      next.width = PEEK_TAB_LENGTH;
      next.height = PEEK_TAB_WIDTH;
      next.x = saved.x + saved.width - ORB_WINDOW_PADDING - PEEK_TAB_LENGTH;
      next.y = workArea.y;
      break;
  }

  win.setBounds({
    x: Math.round(next.x),
    y: Math.round(next.y),
    width: next.width,
    height: next.height,
  });

  dockState.docked = true;
  dockState.edge = nearest;
  return nearest;
}

export function undockWindow(win: BrowserWindow): void {
  if (!dockState.docked || win.isDestroyed()) return;

  const bounds = win.getBounds();
  const workArea = getWorkArea(win);
  const edge = dockState.edge;
  const saved = dockState.savedBounds;

  if (saved) {
    win.setBounds({
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width: saved.width,
      height: saved.height,
    });
  } else if (edge) {
    const next = { ...bounds };
    switch (edge) {
      case 'right':
        next.x = workArea.x + workArea.width - bounds.width;
        break;
      case 'left':
        next.x = workArea.x;
        break;
      case 'bottom':
        next.y = workArea.y + workArea.height - bounds.height;
        break;
      case 'top':
        next.y = workArea.y;
        break;
    }
    win.setBounds({
      x: Math.round(next.x),
      y: Math.round(next.y),
      width: bounds.width,
      height: bounds.height,
    });
  }

  dockState.docked = false;
  dockState.edge = null;
  dockState.savedBounds = null;
}

export function handleMoveWhileDocked(win: BrowserWindow, dx: number, dy: number): boolean {
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
    undockWindow(win);
    return true;
  }
  return false;
}
