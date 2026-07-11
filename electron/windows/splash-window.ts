import { BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

export function createSplashWindow(): BrowserWindow {
  let iconPath = path.join(__dirname, '../../assets/logoof nexus.jpeg');
  if (!fs.existsSync(iconPath)) {
    iconPath = path.join(__dirname, '../../../electron/assets/logoof nexus.jpeg');
  }

  const win = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    backgroundColor: '#181715',
  });

  // Load logo SVG directly from disk to keep single source of truth!
  let logoSvgPath = path.join(__dirname, '../../assets/logo.svg');
  if (!fs.existsSync(logoSvgPath)) {
    logoSvgPath = path.join(__dirname, '../../../electron/assets/logo.svg');
  }
  let logoSvgContent = '';
  try {
    logoSvgContent = fs.readFileSync(logoSvgPath, 'utf8');
    // Strip XML declaration
    logoSvgContent = logoSvgContent.replace(/<\?xml.*?\?>/g, '');
  } catch (e) {
    console.error('Failed to load logo SVG:', e);
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            background: #181715;
            color: #faf9f5;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            border: 1px solid #252320;
            border-radius: 12px;
            overflow: hidden;
          }

          /* Container for the logo markup */
          .logo-container {
            position: absolute;
            z-index: 1;
            width: 180px;
            height: 180px;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.15; /* watermark behind text */
          }

          /* SVG logo background markup */
          .logo-svg {
            width: 140px;
            height: 140px;
            display: block;
          }
          .logo-svg svg {
            width: 100%;
            height: 100%;
            display: block;
          }

          /* Pulse Ring Loading Indicator around the logo */
          .loading-ring {
            position: absolute;
            width: 160px;
            height: 160px;
            border: 2px solid transparent;
            border-top-color: #cc785c;
            border-radius: 50%;
            animation: spin 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          .content-wrapper {
            position: relative;
            z-index: 2;
            text-align: center;
            display: flex;
            flex-direction: column;
            align-items: center;
          }

          h1 {
            font-family: Georgia, serif;
            font-size: 32px;
            font-weight: 500;
            letter-spacing: -0.5px;
            color: #faf9f5;
            margin-bottom: 6px;
          }

          .tagline {
            font-size: 13px;
            font-weight: 500;
            color: #a09d96;
            letter-spacing: 0.5px;
            margin-bottom: 24px;
          }

          .status {
            font-size: 11.5px;
            color: #8e8b82;
            letter-spacing: 0.2px;
          }
        </style>
      </head>
      <body>
        <div class="logo-container">
          <div class="loading-ring"></div>
          <div class="logo-svg">
            ${logoSvgContent}
          </div>
        </div>
        <div class="content-wrapper">
          <h1>Nexus</h1>
          <p class="tagline">Meeting Intelligence</p>
          <p class="status">Initialising intelligence engines&hellip;</p>
        </div>
      </body>
    </html>
  `;

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);
  return win;
}
