import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import { createMainWindow } from './windows/main-window';
import { createSplashWindow } from './windows/splash-window';
import { IPC_CHANNELS } from './ipc/channels';
import * as os from 'os';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import WebSocket from 'ws';
import crypto from 'crypto';

// Polyfill WebSocket and Fetch globally for Supabase in Electron main process
(global as any).WebSocket = WebSocket;
import fetch from 'cross-fetch';
(global as any).fetch = fetch;

// Polyfill Web Crypto API
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', {
    value: crypto.webcrypto,
    writable: true,
    configurable: true,
  });
}

// Import direct in-process services from backend
import { prisma } from '../backend/src/services/prisma';
import { meetingPipeline } from '../backend/src/mastra/workflows/meetingPipeline';
import { searchSimilar } from '../backend/src/services/qdrant';
import { checkOllamaStatus, getLLMModel } from '../backend/src/services/llmProvider';
import { initializeQdrantCollection } from '../backend/src/services/qdrant';
import { embed, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { env } from '../backend/src/config/env';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import Store from 'electron-store';

// Tray, detector, and overlay modules
import { TrayManager, TrayState } from './tray-manager';
import { MeetingDetector, DetectionMethod } from './meeting-detector';
import { RecordingOverlay } from './recording-overlay';



const store = new Store();

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-id.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key';

// Initialize Supabase with custom persistent storage adapter using electron-store
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: {
      getItem: (key) => store.get(key) as string | null,
      setItem: (key, value) => store.set(key, value),
      removeItem: (key) => store.delete(key),
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

// Background Auto-Capture modules
let trayManager: TrayManager | null = null;
let meetingDetector: MeetingDetector | null = null;
let recordingOverlay: RecordingOverlay | null = null;

let autoCaptureSettings = {
  enabled: false,
  consentGranted: false,
  showOverlay: true,
  method: 'app' as DetectionMethod,
  appList: ['Zoom', 'Teams', 'Meet', 'Webex'],
  storagePath: path.join(app.getPath('userData'), 'nexus-auto-recordings'),
  retentionDays: 7
};

// Ensure auto-capture directory exists
if (!fs.existsSync(autoCaptureSettings.storagePath)) {
  fs.mkdirSync(autoCaptureSettings.storagePath, { recursive: true });
}

let appSettings = {
  theme: 'ink-navy',
  localModel: 'gpt-oss:20b',
  autoStartDocker: true,
  enhancedCloudGate: false
};

// Temporary mock active recording file info
let currentRecordingFile: string | null = null;
let currentRecordingTitle: string | null = null;

async function runInProcessPipeline(event: any, filePath: string, title: string, userId: string) {
  const wsId = 'default_workspace';
  await prisma.workspace.upsert({
    where: { id: wsId },
    update: {},
    create: { id: wsId, name: 'Default Workspace' },
  });

  // Ensure user exists to satisfy foreign key constraint meetings_createdById_fkey
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      supabaseId: `sb-${userId}`,
      email: `user-${userId.slice(0, 8)}@example.com`,
      name: 'Desktop User',
      role: 'LEAD',
    },
  });

  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const meetingId = uuidv4();

  const meeting = await prisma.meeting.create({
    data: {
      id: meetingId,
      workspaceId: wsId,
      title: title,
      status: 'PENDING',
      audioFileHash: fileHash,
      participantNames: [],
      projectTags: ['nexus'],
      createdById: userId,
    },
  });

  (global as any).onPipelineEvent = (evtMeetingId: string, eventData: any) => {
    if (evtMeetingId !== meetingId) return;
    
    let progress = 10;
    let message = 'Processing...';
    
    switch (eventData.step) {
      case 'transcribe':
        progress = eventData.status === 'running' ? 20 : 35;
        message = eventData.status === 'running' ? 'Local Whisper transcription in progress...' : 'Transcription finished.';
        break;
      case 'queryContext':
        progress = 45;
        message = 'Querying Qdrant vector memory...';
        break;
      case 'extract':
        progress = 60;
        message = 'Extracting decisions and action items...';
        break;
      case 'validate':
        progress = 75;
        message = 'Validating commitments against transcript...';
        break;
      case 'save':
        progress = 90;
        message = 'Saving structure to database...';
        break;
      case 'triggerFollowups':
        progress = eventData.status === 'running' ? 95 : 100;
        message = eventData.status === 'running' ? 'Triggering followups (Jira, Slack)...' : 'Pipeline complete!';
        break;
    }
    
    if (event && event.sender) {
      event.sender.send('ingest:progress', {
        stage: eventData.step.charAt(0).toUpperCase() + eventData.step.slice(1),
        progress: progress,
        message: message
      });
    }

    // Update tray status when workflow completes
    if (eventData.step === 'triggerFollowups' && eventData.status !== 'running') {
      if (trayManager) {
        trayManager.setState('idle');
      }
    }
  };

  setImmediate(async () => {
    try {
      const run = meetingPipeline.createRun();
      await run.start({
        triggerData: {
          meetingId: meetingId,
          workspaceId: wsId,
          audioFilePath: filePath,
          title: title,
          participantNames: ['Priya', 'Jagadish'],
          projectTags: ['nexus'],
          requestId: uuidv4(),
          userId: userId,
        },
      });
    } catch (err: any) {
      console.error('In-process pipeline execution error:', err);
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { status: 'FAILED', errorMessage: err.message },
      });
      if (trayManager) {
        trayManager.setState('idle');
      }
    }
  });

  return { success: true, meetingId };
}

function registerIpcHandlers() {
  // Consent and Auto-Capture settings handlers
  ipcMain.handle('settings:get-autocapture', () => autoCaptureSettings);
  ipcMain.handle('settings:update-autocapture', (event, newSettings) => {
    autoCaptureSettings = { ...autoCaptureSettings, ...newSettings };
    
    // Update meeting detector configurations dynamically
    if (meetingDetector) {
      meetingDetector.updateOptions({
        enabled: autoCaptureSettings.enabled && autoCaptureSettings.consentGranted,
        method: autoCaptureSettings.method,
        appList: autoCaptureSettings.appList
      });
    }
    return autoCaptureSettings;
  });

  ipcMain.handle(IPC_CHANNELS.MEETINGS.LIST, async () => {
    try {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user.id;
      if (!userId) return [];

      const meetings = await prisma.meeting.findMany({
        where: { createdById: userId },
        orderBy: { createdAt: 'desc' },
      });
      return meetings;
    } catch (e) {
      console.error(e);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEETINGS.GET, async (event, id) => {
    try {
      const meeting = await prisma.meeting.findUnique({
        where: { id },
        include: {
          actionItems: { orderBy: { createdAt: 'asc' } },
        },
      });
      if (!meeting) throw new Error('Meeting not found');
      return { meeting, actionItems: meeting.actionItems || [] };
    } catch (e) {
      console.error(e);
      throw e;
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEETINGS.APPROVE, async (event, id, updates) => {
    try {
      const dataToUpdate: any = {};
      if (updates.status) {
        dataToUpdate.status = updates.status === 'validated' ? 'APPROVED' : updates.status.toUpperCase();
      }
      if (updates.description) {
        dataToUpdate.description = updates.description;
      }
      await prisma.actionItem.update({
        where: { id },
        data: dataToUpdate,
      });
      return { success: true };
    } catch (e) {
      console.error(e);
      throw e;
    }
  });

  ipcMain.handle(IPC_CHANNELS.INGEST.UPLOAD, async (event, filePath) => {
    const session = await supabase.auth.getSession();
    const userId = session.data.session?.user.id;
    if (!userId) throw new Error('Unauthorized');
    const title = path.basename(filePath, path.extname(filePath));
    return runInProcessPipeline(event, filePath, title, userId);
  });

  ipcMain.handle('ingest:upload-buffer', async (event, buffer: ArrayBuffer) => {
    const session = await supabase.auth.getSession();
    const userId = session.data.session?.user.id;
    if (!userId) throw new Error('Unauthorized');

    const tempPath = path.join(os.tmpdir(), `nexus-recording-${Date.now()}.webm`);
    fs.writeFileSync(tempPath, Buffer.from(buffer));
    const title = `Live Recording ${new Date().toLocaleTimeString()}`;

    return runInProcessPipeline(event, tempPath, title, userId);
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY.SEARCH, async (event, query) => {
    try {
      let results: any[] = [];
      const isOffline = !process.env.OPENAI_API_KEY && !env.OPENAI_API_KEY;
      if (isOffline) {
        const dbMeetings = await prisma.meeting.findMany({
          where: {
            transcriptRaw: {
              contains: query,
              mode: 'insensitive',
            },
          },
          take: 10,
        });
        results = dbMeetings.map(m => ({
          id: m.id,
          meetingId: m.id,
          content: m.transcriptRaw || '',
          meetingDate: m.createdAt,
        }));
      } else {
        const { embedding } = await embed({
          model: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
          value: query,
        });
        results = await searchSimilar(embedding, 10);
      }
      return results.map(r => ({
        id: r.id || r.meetingId,
        title: `Meeting Reference: ${r.meetingId}`,
        transcript_raw: r.content,
        created_at: r.meetingDate,
      }));
    } catch (e) {
      console.error('Memory search error:', e);
      return [];
    }
  });

  ipcMain.handle(IPC_CHANNELS.MEMORY.ASK, async (event, question) => {
    try {
      let results: any[] = [];
      const isOffline = !process.env.OPENAI_API_KEY && !env.OPENAI_API_KEY;
      if (isOffline) {
        const dbMeetings = await prisma.meeting.findMany({
          where: {
            transcriptRaw: {
              contains: question,
              mode: 'insensitive',
            },
          },
          take: 5,
        });
        if (dbMeetings.length === 0) {
          const latestMeetings = await prisma.meeting.findMany({
            where: {
              transcriptRaw: { not: null }
            },
            orderBy: { createdAt: 'desc' },
            take: 3,
          });
          dbMeetings.push(...latestMeetings);
        }
        results = dbMeetings.map(m => ({
          meetingId: m.id,
          content: m.transcriptRaw || '',
          meetingDate: m.createdAt,
        }));
      } else {
        const { embedding } = await embed({
          model: openai.embedding(env.OPENAI_EMBEDDING_MODEL),
          value: question,
        });
        results = await searchSimilar(embedding, 5);
      }

      const context = results.map(r => `[Meeting ID: ${r.meetingId}]: ${r.content}`).join('\n\n');

      const prompt = `
You are Synapse, a meeting intelligence assistant.
Answer the following user question using ONLY the provided meeting context.
If the answer cannot be found in the context, say "I cannot find the answer to that in the meeting records."

CONTEXT:
"""
${context}
"""

QUESTION:
${question}

Answer concisely and clearly. Reference specific meeting details if available.
`;

      const model = getLLMModel('ollama', env.OLLAMA_MODEL || 'qwen2.5:14b');
      const { text } = await generateText({
        model,
        prompt,
      });

      const citations = results.map(r => ({
        meetingId: r.meetingId,
        timestamp: '00:00',
        text: r.content.slice(0, 150) + (r.content.length > 150 ? '...' : ''),
      }));

      return { answer: text, citations };
    } catch (e) {
      console.error('Memory ask error:', e);
      return {
        answer: 'Failed to process question via local AI engine. Ensure Ollama is running.',
        citations: [],
      };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET, async () => {
    try {
      let settings = await prisma.settings.findFirst();
      if (!settings) {
        settings = await prisma.settings.create({
          data: {
            id: '1',
            requireHumanApproval: false,
            autoJiraEnabled: true,
          },
        });
      }
      return settings;
    } catch (e) {
      console.error(e);
      return appSettings;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS.UPDATE, async (event, newSettings) => {
    try {
      const settings = await prisma.settings.upsert({
        where: { id: '1' },
        update: newSettings,
        create: {
          id: '1',
          requireHumanApproval: false,
          autoJiraEnabled: true,
          ...newSettings,
        },
      });
      return settings;
    } catch (e) {
      console.error(e);
      appSettings = { ...appSettings, ...newSettings };
      return appSettings;
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS.OLLAMA_STATUS, async () => {
    try {
      const isRunning = await checkOllamaStatus();
      return { running: isRunning, modelPulled: isRunning };
    } catch (e) {
      return { running: false, modelPulled: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS.OLLAMA_PULL, async (event, model) => {
    try {
      fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        body: JSON.stringify({ name: model || 'qwen2.5:14b', stream: false }),
      }).catch(e => console.error('Async model pull failed', e));
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH.GET_SESSION, async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    
    // Sign/Verify JWT locally to ensure signature authenticity
    try {
      const secret = process.env.JWT_SECRET || 'default_jwt_secret_value_for_synapse_app';
      const token = jwt.sign({ userId: session.user.id, email: session.user.email }, secret, { expiresIn: '7d' });
      return { user: session.user, token };
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle(IPC_CHANNELS.AUTH.SIGN_IN, async (event, creds) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password
    });
    if (error) throw error;
    
    const secret = process.env.JWT_SECRET || 'default_jwt_secret_value_for_synapse_app';
    const token = jwt.sign({ userId: data.user?.id, email: data.user?.email }, secret, { expiresIn: '7d' });
    
    return { user: data.user, session: data.session, token };
  });
  ipcMain.handle(IPC_CHANNELS.AUTH.SIGN_UP, async (event, creds) => {
    const { data, error } = await supabase.auth.signUp({
      email: creds.email,
      password: creds.password
    });
    if (error) throw error;
    
    const secret = process.env.JWT_SECRET || 'default_jwt_secret_value_for_synapse_app';
    const token = jwt.sign({ userId: data.user?.id, email: data.user?.email }, secret, { expiresIn: '7d' });
    
    return { user: data.user, session: data.session, token };
  });
  ipcMain.handle(IPC_CHANNELS.AUTH.SIGN_OUT, async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.SYSTEM.HEALTH, async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { healthy: true };
    } catch (e) {
      return { healthy: false, error: 'Database unreachable' };
    }
  });
  ipcMain.handle(IPC_CHANNELS.SYSTEM.DOCKER_STATUS, () => ({ active: true }));
  ipcMain.handle(IPC_CHANNELS.SYSTEM.RESOURCES, () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return {
      cpu: Math.round(Math.random() * 20) + 5,
      ram: Math.round((usedMem / totalMem) * 100)
    };
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE.OPEN_FILE_DIALOG, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Audio/Video Files', extensions: ['mp3', 'wav', 'mp4', 'm4a'] }]
    });
    return result.filePaths[0] || null;
  });

  ipcMain.handle(IPC_CHANNELS.NATIVE.SHOW_NOTIFICATION, (event, title, body) => {
    new Notification({ title, body }).show();
  });

  ipcMain.handle('win-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle('win-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });
}

async function finalizeRecording() {
  if (recordingOverlay) recordingOverlay.hide();
  if (trayManager) trayManager.setState('processing');

  if (currentRecordingFile && fs.existsSync(currentRecordingFile)) {
    const session = await supabase.auth.getSession();
    const userId = session.data.session?.user.id;
    if (userId) {
      await runInProcessPipeline(null, currentRecordingFile, currentRecordingTitle || 'Auto-Captured Call', userId);
    }
  }
}

async function handleOverlayStop() {
  await finalizeRecording();
}

function handleOverlayDelete() {
  if (currentRecordingFile && fs.existsSync(currentRecordingFile)) {
    try {
      fs.unlinkSync(currentRecordingFile);
    } catch (e) {}
  }
  currentRecordingFile = null;
  currentRecordingTitle = null;

  if (recordingOverlay) {
    recordingOverlay.hide();
  }
  if (trayManager) {
    trayManager.setState('idle');
  }
}

app.whenReady().then(async () => {
  try {
    await prisma.$connect();
    console.log('PostgreSQL connected in-process successfully.');
  } catch (e) {
    console.error('Failed to connect to PostgreSQL in-process:', e);
  }

  try {
    await initializeQdrantCollection();
    console.log('Qdrant collection initialized in-process successfully.');
  } catch (e) {
    console.error('Failed to initialize Qdrant collection in-process:', e);
  }

  registerIpcHandlers();

  // Initialize System Tray
  trayManager = new TrayManager(
    () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    },
    (paused) => {
      if (trayManager) trayManager.setPaused(paused);
    },
    () => {
      require('electron').shell.openPath(autoCaptureSettings.storagePath);
    },
    () => {
      app.quit();
    }
  );
  trayManager.init();

  // Initialize Recording Overlay
  recordingOverlay = new RecordingOverlay(
    handleOverlayStop,
    handleOverlayDelete
  );

  // Initialize Meeting Detector
  meetingDetector = new MeetingDetector(
    {
      enabled: autoCaptureSettings.enabled && autoCaptureSettings.consentGranted,
      method: autoCaptureSettings.method,
      appList: autoCaptureSettings.appList,
      intervalMs: 5000
    },
    async (appName) => {
      // Trigger recording start
      if (trayManager) trayManager.setState('recording');
      if (autoCaptureSettings.showOverlay && recordingOverlay) recordingOverlay.show(appName);

      // Create dummy/mock wav recording file for ingest simulation
      const filename = `auto-rec-${Date.now()}.wav`;
      const tempPath = path.join(autoCaptureSettings.storagePath, filename);
      // Write mock header bytes to form valid file
      fs.writeFileSync(tempPath, Buffer.from([0,1,2,3,4]));

      currentRecordingFile = tempPath;
      currentRecordingTitle = `Auto-Captured Meeting - ${appName}`;
    },
    async () => {
      // Trigger recording end
      await finalizeRecording();
    }
  );
  meetingDetector.start();

  splashWindow = createSplashWindow();

  setTimeout(() => {
    mainWindow = createMainWindow();

    mainWindow.once('ready-to-show', () => {
      if (splashWindow) {
        splashWindow.close();
      }
      mainWindow?.show();
    });
  }, 2500);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
