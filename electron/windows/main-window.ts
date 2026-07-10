import { BrowserWindow, session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export function createMainWindow(): BrowserWindow {
  let iconPath = path.join(__dirname, '../../assets/icon.png');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(__dirname, '../../../electron/assets/icon.png');
  }

  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    frame: false, // frameless window
    backgroundColor: '#faf9f5', // match Claude cream theme
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    }
  });

  // Load from packaged dist or local build
  // __dirname = dist-electron/electron/windows/ → go up 3 levels to project root → dist/index.html
  const indexPath = path.join(__dirname, '../../../dist/index.html');
  win.loadFile(indexPath).catch(() => {
    // Fallback for alternative build layouts
    win.loadFile(path.join(__dirname, '../../src/index.html'));
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (Source: ${sourceId}:${line})`);
  });

  // Grant media permission automatically for WebRTC/microphone auto-capture
  session.defaultSession.setPermissionRequestHandler((webContents: any, permission: string, callback: (granted: boolean) => void) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents: any, permission: string, requestingOrigin: string, details: any) => {
    if (permission === 'media') {
      return true;
    }
    return false;
  });

  return win;
}
