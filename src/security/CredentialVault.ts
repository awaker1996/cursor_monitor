import { safeStorage } from 'electron';
import { createLogger } from '../utils/logger';

const log = createLogger('CredentialVault');

const SERVICE_NAME = 'cursor-token-monitor';
const ACCOUNT_NAME = 'session-cookie';

type KeytarModule = typeof import('keytar');

let keytar: KeytarModule | null = null;

function resolveKeytarModule(mod: KeytarModule & { default?: KeytarModule }): KeytarModule | null {
  const resolved = mod.default ?? mod;
  if (
    typeof resolved.setPassword === 'function' &&
    typeof resolved.getPassword === 'function' &&
    typeof resolved.deletePassword === 'function'
  ) {
    return resolved;
  }
  return null;
}

async function getKeytar(): Promise<KeytarModule | null> {
  if (keytar !== null) return keytar;
  try {
    const mod = await import('keytar');
    keytar = resolveKeytarModule(mod as KeytarModule & { default?: KeytarModule });
    if (!keytar) {
      log.warn('keytar module incomplete, using safeStorage fallback');
    }
    return keytar;
  } catch {
    log.warn('keytar unavailable, using safeStorage fallback');
    return null;
  }
}

export class CredentialVault {
  private fallbackPath: string | null = null;

  setFallbackPath(userDataPath: string): void {
    this.fallbackPath = userDataPath;
  }

  async saveCookie(cookie: string): Promise<void> {
    const kt = await getKeytar();
    if (kt) {
      await kt.setPassword(SERVICE_NAME, ACCOUNT_NAME, cookie);
      log.info('Cookie saved to system credential store');
      return;
    }

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(cookie);
      const fs = await import('fs');
      const path = await import('path');
      if (!this.fallbackPath) throw new Error('Fallback path not configured');
      const file = path.join(this.fallbackPath, '.credential');
      fs.writeFileSync(file, encrypted);
      log.info('Cookie saved to encrypted local storage');
      return;
    }

    throw new Error('No secure storage available');
  }

  async getCookie(): Promise<string | null> {
    const kt = await getKeytar();
    if (kt) {
      const value = await kt.getPassword(SERVICE_NAME, ACCOUNT_NAME);
      return value ?? null;
    }

    if (safeStorage.isEncryptionAvailable() && this.fallbackPath) {
      const fs = await import('fs');
      const path = await import('path');
      const file = path.join(this.fallbackPath, '.credential');
      if (!fs.existsSync(file)) return null;
      const encrypted = fs.readFileSync(file);
      return safeStorage.decryptString(encrypted);
    }

    return null;
  }

  async clearCookie(): Promise<void> {
    const kt = await getKeytar();
    if (kt) {
      await kt.deletePassword(SERVICE_NAME, ACCOUNT_NAME);
    }

    if (this.fallbackPath) {
      const fs = await import('fs');
      const path = await import('path');
      const file = path.join(this.fallbackPath, '.credential');
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    log.info('Cookie credentials cleared');
  }

  async hasCookie(): Promise<boolean> {
    const cookie = await this.getCookie();
    return Boolean(cookie && cookie.trim().length > 0);
  }
}

export const credentialVault = new CredentialVault();
