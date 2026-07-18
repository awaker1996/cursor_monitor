import {
  BACKOFF_SEQUENCE_MS,
  type PollerState,
  type TokenSnapshot,
} from '../shared/types';
import type { ProviderManager } from './providers/ProviderManager';
import type { SettingsStore } from '../settings/SettingsStore';
import { createLogger } from '../utils/logger';

const log = createLogger('Poller');

export type PollerEventHandler = (event: {
  type: 'snapshot' | 'state' | 'error';
  snapshot?: TokenSnapshot;
  state?: PollerState;
  error?: string;
}) => void;

export class Poller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private state: PollerState = {
    status: 'idle',
    fetching: false,
    activeProvider: 'cookie',
    failureCount: 0,
  };
  private listeners: PollerEventHandler[] = [];
  private backoffIndex = 0;

  constructor(
    private providerManager: ProviderManager,
    private settingsStore: SettingsStore,
  ) {}

  onEvent(handler: PollerEventHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  private emit(event: Parameters<PollerEventHandler>[0]): void {
    this.listeners.forEach((h) => h(event));
  }

  private updateState(partial: Partial<PollerState>): void {
    this.state = { ...this.state, ...partial };
    this.emit({ type: 'state', state: { ...this.state } });
  }

  start(): void {
    const settings = this.settingsStore.get();
    if (!settings.autoRefreshEnabled) {
      this.updateState({ status: 'paused' });
      return;
    }
    this.updateState({ status: 'running' });
    void this.refresh();
  }

  pause(): void {
    this.clearTimer();
    this.updateState({ status: 'paused', nextRefreshAt: undefined, backoffMs: undefined });
  }

  resume(): void {
    const settings = this.settingsStore.get();
    if (!settings.autoRefreshEnabled) return;
    this.backoffIndex = 0;
    this.updateState({ status: 'running', failureCount: 0 });
    void this.refresh();
  }

  async manualRefresh(): Promise<void> {
    await this.doRefresh(false);
  }

  applySettingsChange(): void {
    const settings = this.settingsStore.get();
    this.clearTimer();
    if (!settings.autoRefreshEnabled) {
      this.pause();
    } else if (this.state.status === 'paused') {
      this.resume();
    } else {
      this.backoffIndex = 0;
      this.updateState({ status: 'running', backoffMs: undefined });
      void this.refresh();
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(delayMs: number): void {
    this.clearTimer();
    const nextAt = new Date(Date.now() + delayMs).toISOString();
    this.updateState({ nextRefreshAt: nextAt, backoffMs: delayMs });
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }

  private async refresh(): Promise<void> {
    if (this.state.status === 'paused') return;
    await this.doRefresh(true);
  }

  private async doRefresh(scheduleNext: boolean): Promise<void> {
    const settings = this.settingsStore.get();
    this.updateState({
      activeProvider: this.providerManager.getActiveProvider(),
      fetching: true,
    });

    try {
      const snapshot = await this.providerManager.fetch();
      this.backoffIndex = 0;
      this.updateState({
        status: 'running',
        failureCount: 0,
        lastError: undefined,
        activeProvider: snapshot.source,
      });
      this.emit({ type: 'snapshot', snapshot });

      if (scheduleNext && settings.autoRefreshEnabled && this.state.status !== 'paused') {
        this.scheduleNext(settings.refreshIntervalSec * 1000);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failureCount = this.state.failureCount + 1;
      const backoffMs =
        BACKOFF_SEQUENCE_MS[Math.min(this.backoffIndex, BACKOFF_SEQUENCE_MS.length - 1)];

      this.backoffIndex += 1;
      this.updateState({
        status: 'backoff',
        failureCount,
        lastError: message,
        backoffMs,
      });
      this.emit({ type: 'error', error: message });

      const last = this.providerManager.getLastSnapshot();
      if (last) {
        this.emit({ type: 'snapshot', snapshot: { ...last, stale: true } });
      }

      log.warn('Refresh failed, entering backoff', { backoffMs, failureCount });

      if (scheduleNext && settings.autoRefreshEnabled && this.state.status !== 'paused') {
        this.scheduleNext(backoffMs);
      }
    } finally {
      this.updateState({ fetching: false });
    }
  }

  getState(): PollerState {
    return { ...this.state };
  }

  destroy(): void {
    this.clearTimer();
  }
}
