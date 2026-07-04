import { app, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '../src/shared/types';

export const CUSTOM_ICON_NAME = 'custom-icon.png';

export function getDefaultIconPath(): string {
  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, 'build', 'icon.png');
    if (fs.existsSync(resourcePath)) return resourcePath;
  }
  return path.join(app.getAppPath(), 'build', 'icon.png');
}

export function getCustomIconPath(settings: AppSettings): string | null {
  if (!settings.customIconPath) return null;
  const full = path.join(app.getPath('userData'), settings.customIconPath);
  return fs.existsSync(full) ? full : null;
}

export function getActiveIconPath(settings: AppSettings): string {
  return getCustomIconPath(settings) ?? getDefaultIconPath();
}

export function loadTrayIcon(settings: AppSettings): Electron.NativeImage {
  const iconPath = getActiveIconPath(settings);
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  }
  return nativeImage.createEmpty();
}

export function loadWindowIcon(settings: AppSettings): Electron.NativeImage {
  const iconPath = getActiveIconPath(settings);
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  return nativeImage.createEmpty();
}

export function saveCustomIcon(sourcePath: string): string {
  const dest = path.join(app.getPath('userData'), CUSTOM_ICON_NAME);
  fs.copyFileSync(sourcePath, dest);
  return CUSTOM_ICON_NAME;
}

export function clearCustomIconFile(): void {
  const dest = path.join(app.getPath('userData'), CUSTOM_ICON_NAME);
  if (fs.existsSync(dest)) fs.unlinkSync(dest);
}

export function getIconPreviewDataUrl(settings: AppSettings): string | null {
  const iconPath = getActiveIconPath(settings);
  if (!fs.existsSync(iconPath)) return null;
  const img = nativeImage.createFromPath(iconPath).resize({ width: 64, height: 64 });
  return img.isEmpty() ? null : img.toDataURL();
}
