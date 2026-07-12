import { exec } from 'child_process';
import { promisify } from 'util';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);

export type DetectionMethod = 'app' | 'audio' | 'both';

export interface MeetingDetectorOptions {
  enabled: boolean;
  method: DetectionMethod;
  appList: string[];
  intervalMs: number;
}

export class MeetingDetector {
  private intervalId: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private currentActiveApp: string | null = null;
  private consecutiveNonDetections = 0;
  private readonly maxNonDetectionsGrace = 4;

  constructor(
    private options: MeetingDetectorOptions,
    private onMeetingDetected: (appName: string) => void,
    private onMeetingEnded: () => void
  ) {}

  public start() {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => this.check(), this.options.intervalMs);
    console.log('[MeetingDetector] Started. Enabled:', this.options.enabled, '| Apps:', this.options.appList);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public updateOptions(newOptions: Partial<MeetingDetectorOptions>) {
    this.options = { ...this.options, ...newOptions };
    console.log('[MeetingDetector] Options updated. Enabled:', this.options.enabled);
  }

  private async check() {
    if (this.isChecking || !this.options.enabled) return;
    this.isChecking = true;

    try {
      const detectedApp = await this.checkActiveWindows();

      if (detectedApp) {
        this.consecutiveNonDetections = 0;
        if (!this.currentActiveApp) {
          console.log('[MeetingDetector] Meeting STARTED:', detectedApp);
          this.currentActiveApp = detectedApp;
          this.onMeetingDetected(detectedApp);
        }
      } else if (this.currentActiveApp) {
        this.consecutiveNonDetections++;
        console.log(`[MeetingDetector]  No meeting found. Grace ${this.consecutiveNonDetections}/${this.maxNonDetectionsGrace}`);
        if (this.consecutiveNonDetections >= this.maxNonDetectionsGrace) {
          console.log('[MeetingDetector]  Meeting ENDED.');
          this.currentActiveApp = null;
          this.consecutiveNonDetections = 0;
          this.onMeetingEnded();
        }
      }
    } catch (err) {
      console.error('[MeetingDetector] Error during check:', err);
    } finally {
      this.isChecking = false;
    }
  }

  private async checkActiveWindows(): Promise<string | null> {
    try {
      const scriptPath = path.join(os.tmpdir(), 'nexus-detect.ps1');
      fs.writeFileSync(
        scriptPath,
        "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object Name, MainWindowTitle | ConvertTo-Json"
      );

      const { stdout } = await execAsync(
        `powershell -NonInteractive -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
        { timeout: 4000 }
      );

      if (!stdout.trim()) return null;

      let processes: any = JSON.parse(stdout);
      if (!Array.isArray(processes)) processes = [processes];

      for (const p of processes) {
        if (!p || !p.MainWindowTitle) continue;
        const title: string = (p.MainWindowTitle as string).toLowerCase();
        const procName: string = ((p.Name as string) || '').toLowerCase();

        // Priority: detect Google Meet running inside any browser tab by URL/title
        const isBrowser =
          procName.includes('chrome') ||
          procName.includes('msedge') ||
          procName.includes('firefox') ||
          procName.includes('brave');

        if (isBrowser && (title.includes('meet.google.com') || title.includes('google meet'))) {
          console.log('[MeetingDetector] Google Meet detected in browser tab:', p.MainWindowTitle);
          return 'Google Meet';
        }

        // General: match against configured app list
        for (const app of this.options.appList) {
          const lowerApp = app.toLowerCase();
          if (title.includes(lowerApp) || procName.includes(lowerApp)) {
            console.log('[MeetingDetector] App matched:', app, '| Window:', p.MainWindowTitle);
            return app;
          }
        }
      }
    } catch (e: any) {
      console.error('[MeetingDetector] checkActiveWindows error:', e?.message || e);
    }
    return null;
  }
}
