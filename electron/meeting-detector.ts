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
      }

      if (!detectedApp && (this.options.method === 'audio' || this.options.method === 'both')) {
        detectedApp = await this.checkAudioActivity();
      }

      if (detectedApp && !this.currentActiveApp) {
        this.currentActiveApp = detectedApp;
        this.onMeetingDetected(detectedApp);
      } else if (!detectedApp && this.currentActiveApp) {
        this.currentActiveApp = null;
        this.onMeetingEnded();
      }
    } catch (err) {
      console.error('[MeetingDetector] Error during check:', err);
    } finally {
      this.isChecking = false;
    }
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
      // Fallback or non-windows platform / empty processes
    }
    return null;
  }

  private async checkAudioActivity(): Promise<string | null> {
    // Standard audio check: return 'Audio activity fallback' if meeting audio is simulated/detected
    // In standard node environments, capturing loopback requires native additions. We simulate a fallback check here.
    return null;
  }
}
