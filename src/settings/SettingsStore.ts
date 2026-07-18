import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../shared/types';
import {
  DEFAULT_SETTINGS,
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
} from '../shared/types';

const SETTINGS_FILE = 'settings.json';

export class SettingsStore {
  private settings: AppSettings;
  private filePath: string;
  private listeners: Array<(settings: AppSettings) => void> = [];

  constructor() {
    this.filePath = path.join(app.getPath('userData'), SETTINGS_FILE);
    this.settings = this.load();
  }

  private load(): AppSettings {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as Partial<AppSettings>;
        const merged = { ...DEFAULT_SETTINGS, ...raw };
        const normalized = this.normalize(merged);
        if (normalized.refreshIntervalSec !== merged.refreshIntervalSec) {
          this.settings = normalized;
          this.save();
          return normalized;
        }
        return normalized;
      }
    } catch {
      // fall through to defaults
    }
    return { ...DEFAULT_SETTINGS };
  }

  private normalize(settings: AppSettings): AppSettings {
    const sec = settings.refreshIntervalSec;
    if (!Number.isInteger(sec) || sec < REFRESH_INTERVAL_MIN || sec > REFRESH_INTERVAL_MAX) {
      return {
        ...settings,
        refreshIntervalSec: Math.min(
          REFRESH_INTERVAL_MAX,
          Math.max(REFRESH_INTERVAL_MIN, Number.isFinite(sec) ? Math.round(sec) : DEFAULT_SETTINGS.refreshIntervalSec),
        ),
      };
    }
    return settings;
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = { ...this.settings, ...partial };
    this.save();
    this.listeners.forEach((fn) => fn(this.get()));
    return this.get();
  }

  onChange(listener: (settings: AppSettings) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
