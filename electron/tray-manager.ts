import { Tray, Menu, nativeImage, BrowserWindow } from 'electron';
import * as path from 'path';

export type TrayState = 'idle' | 'recording' | 'processing';

export class TrayManager {
  private tray: Tray | null = null;
  private currentState: TrayState = 'idle';
  private recordingStartTime: number | null = null;
  private isPaused: boolean = false;

  constructor(
    private onOpenDashboard: () => void,
    private onPauseToggle: (paused: boolean) => void,
    private onShowFolder: () => void,
    private onQuit: () => void
  ) {}

  public init() {
    this.tray = new Tray(this.getIconForState('idle'));
    this.update();
  }

  public setState(state: TrayState) {
    this.currentState = state;
    if (state === 'recording') {
      this.recordingStartTime = Date.now();
    } else {
      this.recordingStartTime = null;
    }
    this.update();
  }

  public setPaused(paused: boolean) {
    this.isPaused = paused;
    this.update();
  }

  private update() {
    if (!this.tray) return;

    this.tray.setImage(this.getIconForState(this.currentState));

    let tooltip = 'Synapse';
    if (this.isPaused) {
      tooltip = 'Synapse (Auto-capture Paused)';
    } else if (this.currentState === 'idle') {
      tooltip = 'Synapse - Idle';
    } else if (this.currentState === 'recording') {
      const elapsed = this.recordingStartTime
        ? Math.floor((Date.now() - this.recordingStartTime) / 1000)
        : 0;
      const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
      const secs = (elapsed % 60).toString().padStart(2, '0');
      tooltip = `Synapse (Recording — ${mins}:${secs})`;
    } else if (this.currentState === 'processing') {
      tooltip = 'Synapse (Processing last meeting)';
    }
    this.tray.setToolTip(tooltip);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: this.isPaused ? '▶ Resume Auto-Capture' : '⏸ Pause Auto-Capture',
        click: () => this.onPauseToggle(!this.isPaused)
      },
      { type: 'separator' },
      { label: 'Open Dashboard', click: this.onOpenDashboard },
      { label: 'Show Last Recording Folder', click: this.onShowFolder },
      { type: 'separator' },
      { label: 'Quit', click: this.onQuit }
    ]);
    this.tray.setContextMenu(contextMenu);
  }

  private getIconForState(state: TrayState): Electron.NativeImage {
    let svg = '';
    if (this.isPaused) {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <rect x="3" y="3" width="3" height="10" fill="#8e8b82" />
        <rect x="10" y="3" width="3" height="10" fill="#8e8b82" />
      </svg>`;
    } else if (state === 'idle') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" fill="none" stroke="#6c6a64" stroke-width="2"/>
        <circle cx="8" cy="8" r="3" fill="#6c6a64"/>
      </svg>`;
    } else if (state === 'recording') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke="#cc785c" stroke-width="2"/>
        <circle cx="8" cy="8" r="4" fill="#5db872"/>
      </svg>`;
    } else if (state === 'processing') {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="7" fill="none" stroke="#e8a55a" stroke-width="2"/>
        <circle cx="8" cy="8" r="4" fill="#e8a55a"/>
      </svg>`;
    }

    return nativeImage.createFromBuffer(Buffer.from(svg), { scaleFactor: 2.0 });
  }

  public destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
