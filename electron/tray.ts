import { Menu, Tray, nativeImage } from 'electron';

let tray: Tray | null = null;

export interface TrayCallbacks {
  getIcon: () => Electron.NativeImage;
  onRefresh: () => void;
  onTogglePause: () => void;
  isPaused: () => boolean;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = callbacks.getIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  tray.setToolTip('Cursor Token Monitor');

  const buildMenu = (): Menu => {
    const paused = callbacks.isPaused();
    return Menu.buildFromTemplate([
      {
        label: '立即刷新',
        click: callbacks.onRefresh,
      },
      {
        label: paused ? '恢复自动刷新' : '暂停自动刷新',
        click: callbacks.onTogglePause,
      },
      { type: 'separator' },
      {
        label: '打开设置',
        click: callbacks.onOpenSettings,
      },
      { type: 'separator' },
      {
        label: '退出',
        click: callbacks.onQuit,
      },
    ]);
  };

  tray.setContextMenu(buildMenu());

  tray.on('click', () => {
    tray?.popUpContextMenu();
  });

  tray.on('right-click', () => {
    tray?.setContextMenu(buildMenu());
  });

  return tray;
}

export function updateTrayIcon(icon: Electron.NativeImage): void {
  if (!tray) return;
  tray.setImage(icon.isEmpty() ? nativeImage.createEmpty() : icon);
}

export function updateTrayToolTip(text: string): void {
  if (!tray) return;
  tray.setToolTip(text);
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
