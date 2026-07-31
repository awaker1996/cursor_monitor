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

  /** Legacy cookie account keeps the historical `.credential` filename. */
  private fallbackFileName(account: string): string {
    return account === ACCOUNT_NAME ? '.credential' : `.credential-${account}`;
  }

  async saveSecret(account: string, value: string): Promise<void> {
    const kt = await getKeytar();
    if (kt) {
      await kt.setPassword(SERVICE_NAME, account, value);
      log.info('Secret saved to system credential store', { account });
      return;
    }

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value);
      const fs = await import('fs');
      const path = await import('path');
      if (!this.fallbackPath) throw new Error('Fallback path not configured');
      const file = path.join(this.fallbackPath, this.fallbackFileName(account));
      fs.writeFileSync(file, encrypted);
      log.info('Secret saved to encrypted local storage', { account });
      return;
    }

    throw new Error('No secure storage available');
  }

  async getSecret(account: string): Promise<string | null> {
    const kt = await getKeytar();
    if (kt) {
      const value = await kt.getPassword(SERVICE_NAME, account);
      return value ?? null;
    }

    if (safeStorage.isEncryptionAvailable() && this.fallbackPath) {
      const fs = await import('fs');
      const path = await import('path');
      const file = path.join(this.fallbackPath, this.fallbackFileName(account));
      if (!fs.existsSync(file)) return null;
      const encrypted = fs.readFileSync(file);
      return safeStorage.decryptString(encrypted);
    }

    return null;
  }

  async clearSecret(account: string): Promise<void> {
    const kt = await getKeytar();
    if (kt) {
      await kt.deletePassword(SERVICE_NAME, account);
    }

    if (this.fallbackPath) {
      const fs = await import('fs');
      const path = await import('path');
      const file = path.join(this.fallbackPath, this.fallbackFileName(account));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }

    log.info('Secret cleared', { account });
  }

  async hasSecret(account: string): Promise<boolean> {
    const value = await this.getSecret(account);
    return Boolean(value && value.trim().length > 0);
  }

  async saveCookie(cookie: string): Promise<void> {
    await this.saveSecret(ACCOUNT_NAME, cookie);
  }

  async getCookie(): Promise<string | null> {
    return this.getSecret(ACCOUNT_NAME);
  }

  async clearCookie(): Promise<void> {
    await this.clearSecret(ACCOUNT_NAME);
  }

  async hasCookie(): Promise<boolean> {
    return this.hasSecret(ACCOUNT_NAME);
  }
}

export const credentialVault = new CredentialVault();
