import { Menu, Tray, nativeImage } from 'electron';

let tray: Tray | null = null;

export interface TrayCallbacks {
  getIcon: () => Electron.NativeImage;
  onOpenFlow: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

export function createTray(callbacks: TrayCallbacks): Tray {
  const icon = callbacks.getIcon();
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  tray.setToolTip('Cursor Token Monitor');

  const buildMenu = (): Menu => {
    return Menu.buildFromTemplate([
      {
        label: '流水',
        click: callbacks.onOpenFlow,
      },
      {
        label: '设置',
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
