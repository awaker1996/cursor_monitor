import type { DataSource, ProviderHealth, TokenSnapshot } from '../../shared/types';
import { normalize } from '../normalizer';
import { SnapshotCache } from '../SnapshotCache';
import { OfficialProvider } from './OfficialProvider';
import { CookieProvider } from './CookieProvider';
import type { SettingsStore } from '../../settings/SettingsStore';
import { createLogger } from '../../utils/logger';

const log = createLogger('ProviderManager');

export class ProviderManager {
  private official: OfficialProvider;
  private cookie: CookieProvider;
  private snapshotCache: SnapshotCache;
  private activeProvider: DataSource = 'official';
  private health: Record<DataSource, ProviderHealth> = {
    official: { name: 'official', available: true, consecutiveFailures: 0 },
    cookie: { name: 'cookie', available: false, consecutiveFailures: 0 },
  };
  private lastSnapshot: TokenSnapshot | null = null;

  constructor(private settingsStore: SettingsStore) {
    this.official = new OfficialProvider(() => this.settingsStore.get());
    this.cookie = new CookieProvider(() => this.settingsStore.get());
    this.snapshotCache = new SnapshotCache();
  }

  async initialize(): Promise<void> {
    const cached = this.snapshotCache.load();
    if (cached) {
      this.lastSnapshot = cached;
      log.info('Loaded snapshot from disk cache', { fetchedAt: cached.fetchedAt });
    }

    const cookieConfigured = await this.cookie.isConfigured();
    if (cookieConfigured) {
      this.activeProvider = 'cookie';
      this.health.cookie.available = true;
      log.info('Cookie configured, using cookie provider');
    } else {
      this.activeProvider = 'official';
      log.info('No cookie configured, using official provider');
    }
  }

  getActiveProvider(): DataSource {
    return this.activeProvider;
  }

  getLastSnapshot(): TokenSnapshot | null {
    return this.lastSnapshot;
  }

  getHealth(): ProviderHealth[] {
    return Object.values(this.health);
  }

  async fetch(): Promise<TokenSnapshot> {
    const cookieConfigured = await this.cookie.isConfigured();
    const source: DataSource = cookieConfigured ? 'cookie' : 'official';
    this.activeProvider = source;
    const provider = source === 'cookie' ? this.cookie : this.official;

    try {
      const result = await provider.fetch();
      const snapshot = normalize(result.raw, result.source);
      this.lastSnapshot = snapshot;
      this.snapshotCache.save(snapshot);
      this.health[source] = {
        ...this.health[source],
        available: true,
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: undefined,
      };
      log.info('Fetch succeeded', { source });
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const h = this.health[source];
      h.consecutiveFailures += 1;
      h.lastError = message;
      h.available = false;

      log.warn('Fetch failed', {
        source,
        failures: h.consecutiveFailures,
        error: message,
      });

      if (this.lastSnapshot) {
        return { ...this.lastSnapshot, stale: true };
      }

      throw err;
    }
  }

  async testCookieConnection(): Promise<TokenSnapshot> {
    const prev = this.activeProvider;
    this.activeProvider = 'cookie';
    try {
      return await this.fetch();
    } finally {
      this.activeProvider = prev;
    }
  }

  destroy(): void {
    // no-op
  }
}
