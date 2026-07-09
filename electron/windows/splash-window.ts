import { BrowserWindow } from 'electron';
import * as path from 'path';

export function createSplashWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // Simple raw HTML rendering showing a loading state
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body {
            background: #0B0F14;
            color: #EDEAE3;
            font-family: sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            border: 1px solid #3FB68B;
            border-radius: 8px;
            box-sizing: border-box;
          }
          .spinner {
            border: 4px solid rgba(237, 234, 227, 0.1);
            width: 36px;
            height: 36px;
            border-radius: 50%;
            border-left-color: #3FB68B;
            animation: spin 1s linear infinite;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          h1 {
            font-size: 24px;
            margin-bottom: 8px;
            letter-spacing: 2px;
          }
          p {
            font-size: 12px;
            color: #E0A93E;
          }
        </style>
      </head>
      <body>
        <h1>NEXUS</h1>
        <div class="spinner"></div>
        <p>Initializing Intelligence Engines...</p>
      </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  return win;
}
