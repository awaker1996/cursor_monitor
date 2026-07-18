import { BrowserWindow, screen } from 'electron';
import type { DockEdge } from '../src/shared/types';
import {
  ORB_EXPANDED_HEIGHT,
  ORB_EXPANDED_WIDTH,
  ORB_WINDOW_HEIGHT,
  ORB_WINDOW_WIDTH,
} from './windows/floatingBall';

export const DOCK_THRESHOLD = 24;
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

function getOrbAnchorRect(bounds: Electron.Rectangle): Electron.Rectangle {
  return {
    x: bounds.x + bounds.width - ORB_WINDOW_PADDING - ORB_ANCHOR_SIZE,
    y: bounds.y + bounds.height - ORB_WINDOW_PADDING - ORB_ANCHOR_SIZE,
    width: ORB_ANCHOR_SIZE,
    height: ORB_ANCHOR_SIZE,
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
  saved: Electron.Rectangle,
  workArea: Electron.Rectangle,
): Electron.Rectangle {
  const next: Electron.Rectangle = {
    x: saved.x,
    y: saved.y,
    width: ORB_WINDOW_WIDTH,
    height: ORB_WINDOW_HEIGHT,
  };

  switch (edge) {
    case 'right':
      next.x = workArea.x + workArea.width - ORB_WINDOW_WIDTH;
      break;
    case 'left':
      next.x = workArea.x;
      break;
    case 'bottom':
      next.y = workArea.y + workArea.height - ORB_WINDOW_HEIGHT;
      break;
    case 'top':
      next.y = workArea.y;
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

  if (minDist > DOCK_THRESHOLD) {
    dockState.docked = false;
    dockState.edge = null;
    dockState.savedBounds = null;
    return null;
  }

  if (!dockState.docked) {
    dockState.savedBounds = bounds;
  }

  const saved = dockState.savedBounds ?? bounds;
  const next = getDockedWindowBounds(nearest, saved, workArea);

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

  const saved = dockState.savedBounds;
  if (saved) {
    win.setBounds({
      x: Math.round(saved.x),
      y: Math.round(saved.y),
      width: ORB_EXPANDED_WIDTH,
      height: ORB_EXPANDED_HEIGHT,
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
