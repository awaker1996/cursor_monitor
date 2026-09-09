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

/**
 * 从原图居中裁剪为正方形 NativeImage。
 * 源图可能非正方形（如 1536×1024），直接 resize 会导致变形，
 * 因此先裁剪再缩放。
 */
function cropToSquare(img: Electron.NativeImage): Electron.NativeImage {
  const size = img.getSize();
  const side = Math.min(size.width, size.height);
  if (size.width === size.height) return img;
  const x = Math.floor((size.width - side) / 2);
  const y = Math.floor((size.height - side) / 2);
  return img.crop({ x, y, width: side, height: side });
}

export function loadTrayIcon(settings: AppSettings): Electron.NativeImage {
  const iconPath = getActiveIconPath(settings);
  if (fs.existsSync(iconPath)) {
    const raw = nativeImage.createFromPath(iconPath);
    if (raw.isEmpty()) return nativeImage.createEmpty();
    // 先裁剪为正方形，再缩放到 64×64。
    // Windows 托盘标准尺寸：16×16 (100% DPI)、32×32 (200% DPI)、
    // 高 DPI (300%+) 需 48px+。提供 64×64 确保所有 DPI 下清晰，
    // 系统会自动缩放到合适尺寸。
    return cropToSquare(raw).resize({ width: 64, height: 64 });
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
  const raw = nativeImage.createFromPath(iconPath);
  if (raw.isEmpty()) return null;
  return cropToSquare(raw).resize({ width: 64, height: 64 }).toDataURL();
}
