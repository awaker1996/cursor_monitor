/// <reference types="vite/client" />

import type {
  AppSettings,
  DockEdge,
  PollerState,
  TestConnectionResult,
  UsageFlowFetchResult,
  UsageFlowQuery,
  TokenSnapshot,
} from '../shared/types';
import type {
  SubscriptionCredentialKind,
  SubscriptionInfoResult,
  SubscriptionProviderId,
  SubscriptionProviderMeta,
  SubscriptionUsageQuery,
  SubscriptionUsageResult,
} from '../shared/subscriptionTypes';

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

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

export {};
