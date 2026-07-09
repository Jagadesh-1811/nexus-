import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    minWidth: 1024,
    minHeight: 768,
    frame: false, // frameless window
    backgroundColor: '#0B0F14',
    webPreferences: {
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Load from packaged dist or local build
  const indexPath = path.join(__dirname, '../../dist/index.html');
  win.loadFile(indexPath).catch(() => {
    // If not built yet, load from src for development
    win.loadFile(path.join(__dirname, '../../src/index.html'));
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] ${message} (Source: ${sourceId}:${line})`);
  });

  return win;
}
