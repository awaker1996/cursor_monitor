import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppSettings,
  DockEdge,
  PollerState,
  TestConnectionResult,
  UsageFlowFetchResult,
  UsageFlowQuery,
  TokenSnapshot,
} from '../src/shared/types';
import type {
  SubscriptionCredentialKind,
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageQuery,
  SubscriptionUsageResult,
} from '../src/shared/subscriptionTypes';

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
  openFlow: () => void;
  openSubscriptions: () => void;
  listSubscriptionProviders: () => Promise<SubscriptionProviderMeta[]>;
  saveSubscriptionKey: (
    providerId: SubscriptionProviderId,
    key: string,
    kind?: SubscriptionCredentialKind,
  ) => Promise<boolean>;
  clearSubscriptionKey: (
    providerId: SubscriptionProviderId,
    kind?: SubscriptionCredentialKind,
  ) => Promise<boolean>;
  fetchSubscriptionInfo: (providerId: SubscriptionProviderId) => Promise<SubscriptionInfoResult>;
  fetchSubscriptionUsage: (
    providerId: SubscriptionProviderId,
    query: SubscriptionUsageQuery,
  ) => Promise<SubscriptionUsageResult>;
  fetchUsageFlow: (query: UsageFlowQuery, dateRangeLabel?: string) => Promise<UsageFlowFetchResult>;
  setOrbMode: (mode: 'collapsed' | 'hover' | 'expanded') => void;
  setOrbModeAsync: (mode: 'collapsed' | 'hover' | 'expanded') => Promise<void>;
  setExpanded: (expanded: boolean) => void;
  setExpandedPanelLayout: (layout: 'overview' | 'included') => void;
  setIgnoreMouseEvents: (ignore: boolean) => void;
  getCursorInWindow: () => Promise<{ x: number; y: number } | null>;
  moveWindow: (dx: number, dy: number, grabOffset?: { x: number; y: number }) => void;
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
  openFlow: () => ipcRenderer.send('open-flow'),
  openSubscriptions: () => ipcRenderer.send('open-subscriptions'),
  listSubscriptionProviders: () => ipcRenderer.invoke('subscription-list-providers'),
  saveSubscriptionKey: (providerId, key, kind) =>
    ipcRenderer.invoke('subscription-save-key', providerId, key, kind),
  clearSubscriptionKey: (providerId, kind) =>
    ipcRenderer.invoke('subscription-clear-key', providerId, kind),
  fetchSubscriptionInfo: (providerId) =>
    ipcRenderer.invoke('subscription-fetch-info', providerId),
  fetchSubscriptionUsage: (providerId, query) =>
    ipcRenderer.invoke('subscription-fetch-usage', providerId, query),
  fetchUsageFlow: (query, dateRangeLabel) =>
    ipcRenderer.invoke('fetch-usage-flow', query, dateRangeLabel),
  setOrbMode: (mode) => ipcRenderer.send('set-orb-mode', mode),
  setOrbModeAsync: (mode) => ipcRenderer.invoke('set-orb-mode-async', mode),
  setExpanded: (expanded) => ipcRenderer.send('set-expanded', expanded),
  setExpandedPanelLayout: (layout) => ipcRenderer.send('set-expanded-panel-layout', layout),
  setIgnoreMouseEvents: (ignore) => ipcRenderer.send('set-ignore-mouse-events', ignore),
  getCursorInWindow: () => ipcRenderer.invoke('get-cursor-in-window'),
  moveWindow: (dx, dy, grabOffset) => ipcRenderer.send('move-window', { dx, dy, grabOffset }),
  finishWindowMove: () => ipcRenderer.send('finish-window-move'),
  undockWindow: () => ipcRenderer.send('undock-window'),
  getIconPreview: () => ipcRenderer.invoke('get-icon-preview'),
  selectCustomIcon: () => ipcRenderer.invoke('select-custom-icon'),
  clearCustomIcon: () => ipcRenderer.invoke('clear-custom-icon'),
};

contextBridge.exposeInMainWorld('electronAPI', api);
