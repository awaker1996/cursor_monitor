import type { AppSettings, ProviderResult, TokenProvider } from '../../shared/types';
import { createLogger } from '../../utils/logger';

const log = createLogger('OfficialProvider');

export class OfficialProvider implements TokenProvider {
  readonly name = 'official' as const;

  constructor(private getSettings: () => AppSettings) {}

  async isConfigured(): Promise<boolean> {
    return true;
  }

  async fetch(): Promise<ProviderResult> {
    const settings = this.getSettings();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), settings.requestTimeoutSec * 1000);

    try {
      log.info('Fetching from official endpoint', { endpoint: settings.officialEndpoint });

      const response = await fetch(settings.officialEndpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'CursorTokenMonitor/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Official API returned ${response.status}: ${response.statusText}`);
      }

      const raw = await response.json();
      return { raw, source: 'official', rawVersion: 'official:v1' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Official fetch failed', message);
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}
