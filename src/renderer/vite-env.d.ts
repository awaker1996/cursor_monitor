/// <reference types="vite/client" />

import type {
  AppSettings,
  DockEdge,
  PollerState,
  TestConnectionResult,
  TokenSnapshot,
} from '../shared/types';

export interface ElectronAPI {
  getSnapshot: () => Promise<TokenSnapshot | null>;
  getPollerState: () => Promise<PollerState>;
  getSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  saveCookie: (cookie: string) => Promise<void>;
  clearCookie: () => Promise<boolean>;
  hasCookie: () => Promise<boolean>;
  testConnection: () => Promise<TestConnectionResult>;
  manualRefresh: () => Promise<void>;
  togglePause: () => Promise<boolean>;
  onSnapshot: (callback: (snapshot: TokenSnapshot) => void) => () => void;
  onPollerState: (callback: (state: PollerState) => void) => () => void;
  onSettingsChanged: (callback: (settings: AppSettings) => void) => () => void;
  onDockStateChanged: (callback: (edge: DockEdge | null) => void) => () => void;
  openSettings: () => void;
  setOrbMode: (mode: 'collapsed' | 'hover' | 'expanded') => void;
  setOrbModeAsync: (mode: 'collapsed' | 'hover' | 'expanded') => Promise<void>;
  setExpanded: (expanded: boolean) => void;
  setExpandedPanelLayout: (layout: 'overview' | 'included') => void;
  setIgnoreMouseEvents: (ignore: boolean) => void;
  getCursorInWindow: () => Promise<{ x: number; y: number } | null>;
  moveWindow: (dx: number, dy: number) => void;
  finishWindowMove: () => void;
  undockWindow: () => void;
  getIconPreview: () => Promise<string | null>;
  selectCustomIcon: () => Promise<{ success: boolean; message?: string; preview?: string | null }>;
  clearCustomIcon: () => Promise<{ success: boolean; preview?: string | null }>;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
