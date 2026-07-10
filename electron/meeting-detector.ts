import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type DetectionMethod = 'app' | 'audio' | 'both';

export interface MeetingDetectorOptions {
  enabled: boolean;
  method: DetectionMethod;
  appList: string[]; // e.g. ["Zoom", "Teams", "Meet", "Slack"]
  intervalMs: number;
}

export class MeetingDetector {
  private intervalId: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private currentActiveApp: string | null = null;
  private consecutiveNonDetections = 0;
  private maxNonDetectionsGrace = 4; // 4 checks * 5000ms = 20 seconds grace period for multitasking/tab-switching

  constructor(
    private options: MeetingDetectorOptions,
    private onMeetingDetected: (appName: string) => void,
    private onMeetingEnded: () => void
  ) { }

  public start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.check(), this.options.intervalMs);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public updateOptions(newOptions: Partial<MeetingDetectorOptions>) {
    this.options = { ...this.options, ...newOptions };
  }

  private async check() {
    if (this.isChecking || !this.options.enabled) return;
    this.isChecking = true;

    try {
      let detectedApp: string | null = null;

      if (this.options.method === 'app' || this.options.method === 'both') {
        detectedApp = await this.checkActiveWindows();
        if (detectedApp) {
          // Standard standalone apps don't need WebRTC checks; only check for browser-based Meet calls in 'both' mode
          const isBrowserMeet = ['google meet', 'meet'].includes(detectedApp.toLowerCase());
          if (this.options.method === 'both' && isBrowserMeet) {
            const isMicActive = await this.isMicrophoneActive();
            if (!isMicActive) {
              detectedApp = null;
            }
          }
        }
      }

      if (!detectedApp && (this.options.method === 'audio' || this.options.method === 'both')) {
        detectedApp = await this.checkAudioActivity();
      }

      if (detectedApp) {
        this.consecutiveNonDetections = 0; // Reset counter on successful detection
        if (!this.currentActiveApp) {
          this.currentActiveApp = detectedApp;
          this.onMeetingDetected(detectedApp);
        }
      } else if (this.currentActiveApp) {
        // If no app was detected, but we are currently recording, do a safety double-check:
        // is the microphone still active? (Meaning they are still in the call, just switched tabs/focused another app)
        const isMicStillActive = await this.isMicrophoneActive();
        if (isMicStillActive) {
          this.consecutiveNonDetections = 0; // Reset counter
        } else {
          // Both window matching and microphone check failed: start grace period countdown
          this.consecutiveNonDetections++;
          if (this.consecutiveNonDetections >= this.maxNonDetectionsGrace) {
            this.currentActiveApp = null;
            this.consecutiveNonDetections = 0;
            this.onMeetingEnded();
          }
        }
      }
    } catch (err) {
      console.error('[MeetingDetector] Error during check:', err);
    } finally {
      this.isChecking = false;
    }
  }

  private async isMicrophoneActive(): Promise<boolean> {
    try {
      const regKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone\\NonPackaged';
      const cmd = `reg query "${regKey}" /s`;
      const { stdout } = await execAsync(cmd);
      
      const blocks = stdout.split('HKEY_CURRENT_USER');
      for (const block of blocks) {
        const lowerBlock = block.toLowerCase();
        if (
          lowerBlock.includes('chrome.exe') || 
          lowerBlock.includes('msedge.exe') || 
          lowerBlock.includes('firefox.exe') || 
          lowerBlock.includes('electron.exe') || 
          lowerBlock.includes('teams.exe') || 
          lowerBlock.includes('zoom.exe') ||
          lowerBlock.includes('webex.exe')
        ) {
          if (lowerBlock.includes('lastusedtimestop') && lowerBlock.includes('0x0')) {
            const match = lowerBlock.match(/lastusedtimestop\s+reg_qword\s+(0x0+)\b/);
            if (match) {
              return true;
            }
          }
        }
      }
    } catch (e) {
      // Fallback: return true to avoid blocking auto-record if query fails
      return true;
    }
    return false;
  }

  private async checkActiveWindows(): Promise<string | null> {
    try {
      // Use powershell to list processes with non-empty MainWindowTitle on Windows
      const cmd = `powershell -Command "Get-Process | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object Name, MainWindowTitle | ConvertTo-Json"`;
      const { stdout } = await execAsync(cmd);
      if (!stdout.trim()) return null;

      let processes: any = JSON.parse(stdout);
      if (!Array.isArray(processes)) {
        processes = [processes];
      }

      for (const p of processes) {
        if (!p || !p.MainWindowTitle) continue;
        const title = p.MainWindowTitle.toLowerCase();
        const procName = p.Name.toLowerCase();

        for (const app of this.options.appList) {
          const lowerApp = app.toLowerCase();
          if (title.includes(lowerApp) || procName.includes(lowerApp)) {
            return app;
          }
        }
      }
    } catch (e) {
      // Fallback
    }
    return null;
  }

  private async checkAudioActivity(): Promise<string | null> {
    return null;
  }
}
