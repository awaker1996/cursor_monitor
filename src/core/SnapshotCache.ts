import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { DataSource, TokenSnapshot } from '../shared/types';

const CACHE_FILE = 'snapshot-cache.json';

function isValidDataSource(value: unknown): value is DataSource {
  return value === 'official' || value === 'cookie';
}

function isValidSnapshot(raw: unknown): raw is TokenSnapshot {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  return (
    isValidDataSource(obj.source) &&
    typeof obj.fetchedAt === 'string' &&
    typeof obj.metrics === 'object' &&
    obj.metrics !== null &&
    typeof obj.auto === 'object' &&
    obj.auto !== null &&
    typeof obj.api === 'object' &&
    obj.api !== null
  );
}

export class SnapshotCache {
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), CACHE_FILE);
  }

  load(): TokenSnapshot | null {
    try {
      if (!fs.existsSync(this.filePath)) return null;
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as unknown;
      if (!isValidSnapshot(raw)) return null;
      return { ...raw, stale: true };
    } catch {
      return null;
    }
  }

  save(snapshot: TokenSnapshot): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const toWrite: TokenSnapshot = { ...snapshot, stale: false };
      fs.writeFileSync(this.filePath, JSON.stringify(toWrite, null, 2), 'utf-8');
    } catch {
      // non-fatal: in-memory snapshot still available
    }
  }
}
