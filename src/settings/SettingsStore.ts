import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings, UiStyleMode } from '../shared/types';
import {
  DEFAULT_SETTINGS,
  REFRESH_INTERVAL_MAX,
  REFRESH_INTERVAL_MIN,
} from '../shared/types';
import { normalizeDayMinutes } from '../shared/uiStyle';

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
        if (JSON.stringify(normalized) !== JSON.stringify(merged)) {
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

  /** 逐字段夹紧脏值：旧配置、磁盘损坏或外部写入的非法值都不允许流到业务层。 */
  private normalize(settings: AppSettings): AppSettings {
    const sec = settings.refreshIntervalSec;
    const refreshIntervalSec =
      Number.isInteger(sec) && sec >= REFRESH_INTERVAL_MIN && sec <= REFRESH_INTERVAL_MAX
        ? sec
        : Math.min(
            REFRESH_INTERVAL_MAX,
            Math.max(
              REFRESH_INTERVAL_MIN,
              Number.isFinite(sec) ? Math.round(sec) : DEFAULT_SETTINGS.refreshIntervalSec,
            ),
          );
    const uiStyle: UiStyleMode =
      settings.uiStyle === 'system' ||
      settings.uiStyle === 'aurora' ||
      settings.uiStyle === 'calm' ||
      settings.uiStyle === 'auto'
        ? settings.uiStyle
        : DEFAULT_SETTINGS.uiStyle;
    return {
      ...settings,
      refreshIntervalSec,
      uiStyle,
      uiStyleDayStartMin: normalizeDayMinutes(
        settings.uiStyleDayStartMin,
        DEFAULT_SETTINGS.uiStyleDayStartMin,
      ),
      uiStyleDayEndMin: normalizeDayMinutes(
        settings.uiStyleDayEndMin,
        DEFAULT_SETTINGS.uiStyleDayEndMin,
      ),
    };
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.settings, null, 2), 'utf-8');
  }

  get(): AppSettings {
    return { ...this.settings };
  }

  update(partial: Partial<AppSettings>): AppSettings {
    this.settings = this.normalize({ ...this.settings, ...partial });
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
