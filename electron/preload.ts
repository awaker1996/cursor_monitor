import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  DockEdge,
  PollerState,
  TestConnectionResult,
  TokenSnapshot,
} from '../src/shared/types';

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
  setExpanded: (expanded: boolean) => void;
  moveWindow: (dx: number, dy: number) => void;
  finishWindowMove: () => void;
  undockWindow: () => void;
  getIconPreview: () => Promise<string | null>;
  selectCustomIcon: () => Promise<{ success: boolean; message?: string; preview?: string | null }>;
  clearCustomIcon: () => Promise<{ success: boolean; preview?: string | null }>;
}

const api: ElectronAPI = {
  getSnapshot: () => ipcRenderer.invoke('get-snapshot'),
  getPollerState: () => ipcRenderer.invoke('get-poller-state'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (partial) => ipcRenderer.invoke('update-settings', partial),
  saveCookie: (cookie) => ipcRenderer.invoke('save-cookie', cookie),
  clearCookie: () => ipcRenderer.invoke('clear-cookie'),
  hasCookie: () => ipcRenderer.invoke('has-cookie'),
  testConnection: () => ipcRenderer.invoke('test-connection'),
  manualRefresh: () => ipcRenderer.invoke('manual-refresh'),
  togglePause: () => ipcRenderer.invoke('toggle-pause'),
  onSnapshot: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, snapshot: TokenSnapshot) =>
      callback(snapshot);
    ipcRenderer.on('snapshot-updated', handler);
    return () => ipcRenderer.removeListener('snapshot-updated', handler);
  },
  onPollerState: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, state: PollerState) => callback(state);
    ipcRenderer.on('poller-state', handler);
    return () => ipcRenderer.removeListener('poller-state', handler);
  },
  onSettingsChanged: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, settings: AppSettings) => callback(settings);
    ipcRenderer.on('settings-changed', handler);
    return () => ipcRenderer.removeListener('settings-changed', handler);
  },
  onDockStateChanged: (callback) => {
    const handler = (_: Electron.IpcRendererEvent, edge: DockEdge | null) => callback(edge);
    ipcRenderer.on('dock-state-changed', handler);
    return () => ipcRenderer.removeListener('dock-state-changed', handler);
  },
  openSettings: () => ipcRenderer.send('open-settings'),
  setOrbMode: (mode) => ipcRenderer.send('set-orb-mode', mode),
  setExpanded: (expanded) => ipcRenderer.send('set-expanded', expanded),
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', { dx, dy }),
  finishWindowMove: () => ipcRenderer.send('finish-window-move'),
  undockWindow: () => ipcRenderer.send('undock-window'),
  getIconPreview: () => ipcRenderer.invoke('get-icon-preview'),
  selectCustomIcon: () => ipcRenderer.invoke('select-custom-icon'),
  clearCustomIcon: () => ipcRenderer.invoke('clear-custom-icon'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
