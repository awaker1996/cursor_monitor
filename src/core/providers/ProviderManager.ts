import type { DataSource, ProviderHealth, TokenSnapshot } from '../../shared/types';
import { normalize } from '../normalizer';
import { OfficialProvider } from './OfficialProvider';
import { CookieProvider } from './CookieProvider';
import type { SettingsStore } from '../../settings/SettingsStore';
import { createLogger } from '../../utils/logger';

const log = createLogger('ProviderManager');

export class ProviderManager {
  private official: OfficialProvider;
  private cookie: CookieProvider;
  private activeProvider: DataSource = 'official';
  private health: Record<DataSource, ProviderHealth> = {
    official: { name: 'official', available: true, consecutiveFailures: 0 },
    cookie: { name: 'cookie', available: false, consecutiveFailures: 0 },
  };
  private lastSnapshot: TokenSnapshot | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private settingsStore: SettingsStore) {
    this.official = new OfficialProvider(() => this.settingsStore.get());
    this.cookie = new CookieProvider(() => this.settingsStore.get());
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
    const provider = this.activeProvider === 'official' ? this.official : this.cookie;

    try {
      const result = await provider.fetch();
      const snapshot = normalize(result.raw, result.source);
      this.lastSnapshot = snapshot;
      this.health[this.activeProvider] = {
        ...this.health[this.activeProvider],
        available: true,
        consecutiveFailures: 0,
        lastSuccessAt: new Date().toISOString(),
        lastError: undefined,
      };
      log.info('Fetch succeeded', { source: this.activeProvider });
      return snapshot;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const h = this.health[this.activeProvider];
      h.consecutiveFailures += 1;
      h.lastError = message;
      h.available = false;

      log.warn('Fetch failed', {
        source: this.activeProvider,
        failures: h.consecutiveFailures,
        error: message,
      });

      if (this.activeProvider === 'official') {
        const settings = this.settingsStore.get();
        const cookieConfigured = await this.cookie.isConfigured();
        if (cookieConfigured && h.consecutiveFailures >= settings.failureThreshold) {
          log.info('Switching to cookie provider after official failure');
          this.activeProvider = 'cookie';
          this.startOfficialProbe();
          return this.fetch();
        }
      }

      if (this.lastSnapshot) {
        return { ...this.lastSnapshot, stale: true };
      }

      throw err;
    }
  }

  private startOfficialProbe(): void {
    if (this.probeTimer) return;
    this.probeTimer = setInterval(async () => {
      if (this.activeProvider !== 'cookie') {
        this.stopOfficialProbe();
        return;
      }
      try {
        await this.official.fetch();
        log.info('Official provider recovered, switching back');
        this.activeProvider = 'official';
        this.health.official = {
          ...this.health.official,
          consecutiveFailures: 0,
          available: true,
          lastError: undefined,
        };
        this.stopOfficialProbe();
      } catch {
        // keep probing
      }
    }, 120_000);
  }

  private stopOfficialProbe(): void {
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
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
    this.stopOfficialProbe();
  }
}
