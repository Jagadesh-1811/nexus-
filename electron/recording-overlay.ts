import { BrowserWindow, screen, ipcMain } from 'electron';

export class RecordingOverlay {
  private window: BrowserWindow | null = null;

  constructor(
    private onStopRequested: () => void,
    private onDeleteRequested: () => void
  ) {}

  public show(appName: string) {
    if (this.window) return;

    const display = screen.getPrimaryDisplay();
    const { width } = display.bounds;

    this.window = new BrowserWindow({
      width: 320,
      height: 48,
      x: width - 340,
      y: 50,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              background: #faf9f5;
              border: 1px solid #cc785c;
              border-radius: 8px;
              color: #141413;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              display: flex;
              align-items: center;
              justify-content: space-between;
              padding: 0 16px;
              height: 48px;
              overflow: hidden;
              box-shadow: 0 4px 12px rgba(20,20,19,0.12);
              -webkit-app-region: drag;
            }
            .info {
              display: flex;
              align-items: center;
              gap: 8px;
            }
            .dot {
              width: 8px;
              height: 8px;
              background-color: #c64545;
              border-radius: 50%;
              animation: pulse 1.5s infinite;
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.4; }
            }
            .text {
              font-size: 13px;
              font-weight: 500;
              color: #141413;
            }
            .actions {
              display: flex;
              gap: 6px;
              -webkit-app-region: no-drag;
            }
            .btn {
              background: #efe9de;
              border: 1px solid #e6dfd8;
              color: #141413;
              padding: 4px 10px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
            }
            .btn:hover {
              background: #cc785c;
              color: white;
              border-color: #cc785c;
            }
            .btn-danger:hover {
              background: #c64545;
              color: white;
              border-color: #c64545;
            }
          </style>
        </head>
        <body>
          <div class="info">
            <div class="dot"></div>
            <div class="text">Recording ${appName}...</div>
          </div>
          <div class="actions">
            <button class="btn" onclick="stopRec()">Stop</button>
            <button class="btn btn-danger" onclick="deleteRec()">Delete</button>
          </div>
          <script>
            const { ipcRenderer } = require('electron');
            function stopRec() {
              ipcRenderer.send('overlay-stop');
            }
            function deleteRec() {
              ipcRenderer.send('overlay-delete');
            }
          </script>
        </body>
      </html>
    `;

    this.window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

    // Setup temporary listener
    ipcMain.once('overlay-stop', () => {
      this.onStopRequested();
    });

    ipcMain.once('overlay-delete', () => {
      this.onDeleteRequested();
    });
  }

  public hide() {
    if (this.window) {
      this.window.close();
      this.window = null;
      ipcMain.removeAllListeners('overlay-stop');
      ipcMain.removeAllListeners('overlay-delete');
    }
  }
}
