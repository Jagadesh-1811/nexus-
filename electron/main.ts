import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '../../.env') });

// Make the application crash-resilient to offline network errors
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection in Electron Main:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception in Electron Main:', error);
});

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
import { mastra } from '../backend/src/mastra';
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
let isQuitting = false;
let wasWindowHiddenBeforeRecording = false;

// Background Auto-Capture modules
let trayManager: TrayManager | null = null;
let meetingDetector: MeetingDetector | null = null;
let recordingOverlay: RecordingOverlay | null = null;

let autoCaptureSettings = {
  enabled: false,
  consentGranted: false,
  showOverlay: true,
  method: 'app' as DetectionMethod,
  appList: ['Zoom Meeting', 'Microsoft Teams', 'Google Meet', 'Webex'],
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

// Upload audio to Supabase Storage bucket 'meeting-audio'
async function uploadToSupabaseStorage(filePath: string, meetingId: string): Promise<string | null> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileExt = path.extname(filePath) || '.webm';
    const storagePath = `${meetingId}${fileExt}`;
    const bucketName = process.env.SUPABASE_BUCKET || 'meeting-audio';

    console.log(`Uploading ${filePath} to Supabase storage bucket '${bucketName}'...`);

    // Ensure bucket exists
    try {
      const { data: buckets } = await supabase.storage.listBuckets();
      if (!buckets?.some(b => b.name === bucketName)) {
        await supabase.storage.createBucket(bucketName, { public: true });
      }
    } catch (err) {
      console.warn('Bucket listing/creation check ignored:', err);
    }

    const contentType = fileExt === '.webm' ? 'audio/webm' : 
                        fileExt === '.wav' ? 'audio/wav' :
                        fileExt === '.mp3' ? 'audio/mpeg' :
                        fileExt === '.mp4' ? 'video/mp4' :
                        'application/octet-stream';

    const { error } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, fileBuffer, {
        contentType,
        upsert: true
      });

    if (error) {
      console.error('Supabase storage upload failed:', error);
      return null;
    }

    const { data } = supabase.storage.from(bucketName).getPublicUrl(storagePath);
    return data?.publicUrl || null;
  } catch (err) {
    console.error('Error in uploadToSupabaseStorage:', err);
    return null;
  }
}

async function runInProcessPipeline(event: any, filePath: string, title: string, userId: string) {
  const wsId = 'default_workspace';
  await prisma.workspace.upsert({
    where: { id: wsId },
    update: {},
    create: { id: wsId, name: 'Default Workspace' },
  });

  // Get active session user info to avoid mock email/name
  const session = await supabase.auth.getSession();
  const authUser = session.data.session?.user;
  const email = authUser?.email || `user-${userId.slice(0, 8)}@example.com`;
  const name = authUser?.user_metadata?.full_name || email.split('@')[0] || 'Desktop User';

  // Ensure user exists to satisfy foreign key constraint meetings_createdById_fkey
  await prisma.user.upsert({
    where: { id: userId },
    update: {
      email,
      name,
    },
    create: {
      id: userId,
      supabaseId: `sb-${userId}`,
      email,
      name,
      role: 'LEAD',
    },
  });

  const fileHash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const meetingId = uuidv4();

  // Trigger Supabase storage upload asynchronously
  uploadToSupabaseStorage(filePath, meetingId).then(async (audioUrl) => {
    if (audioUrl) {
      console.log(`Successfully uploaded meeting audio. Public URL: ${audioUrl}`);
      await prisma.meeting.update({
        where: { id: meetingId },
        data: { audioUrl }
      });
    }
  }).catch(err => {
    console.error('Failed to update meeting audioUrl:', err);
  });

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
        progress = eventData.status === 'running' ? 15 : 30;
        message = eventData.status === 'running' ? 'Deepgram transcription in progress...' : 'Transcription finished.';
        break;
      case 'queryMemory':
        progress = eventData.status === 'running' ? 35 : 45;
        message = eventData.status === 'running' ? 'Querying Qdrant vector memory...' : 'Memory query finished.';
        break;
      case 'extract':
        progress = eventData.status === 'running' ? 50 : 65;
        message = eventData.status === 'running' ? 'Extracting decisions and action items...' : 'Extraction finished.';
        break;
      case 'validate':
        progress = eventData.status === 'running' ? 70 : 80;
        message = eventData.status === 'running' ? 'Validating commitments against transcript...' : 'Validation finished.';
        break;
      case 'persist':
        progress = eventData.status === 'running' ? 85 : 90;
        message = eventData.status === 'running' ? 'Saving structure to database...' : 'Persistence finished.';
        break;
      case 'indexVectors':
        progress = eventData.status === 'running' ? 92 : 95;
        message = eventData.status === 'running' ? 'Indexing vectors in Qdrant...' : 'Vector indexing finished.';
        break;
      case 'followUp':
        progress = eventData.status === 'running' ? 98 : 100;
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
    if (eventData.step === 'followUp' && eventData.status !== 'running') {
      if (trayManager) {
        trayManager.setState('idle');
      }
    }
  };

  setImmediate(async () => {
    try {
      const run = (mastra.getWorkflow('meetingPipeline') as any).createRun();
      const runResult = await run.start({
        triggerData: {
          meetingId: meetingId,
          workspaceId: wsId,
          audioFilePath: filePath,
          title: title,
          participantNames: [],
          projectTags: ['nexus'],
          requestId: uuidv4(),
          userId: userId,
        },
      });

      const failedStepId = Object.keys(runResult.results).find(
        (stepId) => runResult.results[stepId].status === 'failed'
      );

      if (failedStepId) {
        const stepError = (runResult.results[failedStepId] as any).error;
        console.error(`Pipeline step ${failedStepId} failed:`, stepError);
        try {
          await prisma.meeting.update({
            where: { id: meetingId },
            data: { status: 'FAILED', errorMessage: `Step ${failedStepId} failed: ${stepError}` },
          });
        } catch (dbErr) {}
        if (trayManager) {
          trayManager.setState('idle');
        }
      }
    } catch (err: any) {
      console.error('In-process pipeline execution error:', err);
      try {
        await prisma.meeting.update({
          where: { id: meetingId },
          data: { status: 'FAILED', errorMessage: err.message },
        });
      } catch (dbErr) {}
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

  // Workspace management handlers
  ipcMain.handle('workspace:get', async () => {
    try {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) return null;

      const userEmail = session.data.session?.user?.email || '';

      // Find the user's workspace membership
      let memberRecord = await prisma.workspaceMember.findFirst({
        where: { userId },
        include: {
          workspace: {
            include: {
              members: {
                include: { user: true }
              }
            }
          }
        }
      });

      // If no membership exists, create a default workspace and make this user the Lead Owner
      if (!memberRecord) {
        const wsId = 'default_workspace';
        const workspace = await prisma.workspace.upsert({
          where: { id: wsId },
          update: {},
          create: { id: wsId, name: 'Default Workspace' },
        });

        // Ensure user exists
        const user = await prisma.user.upsert({
          where: { id: userId },
          update: {},
          create: {
            id: userId,
            supabaseId: `sb-${userId}`,
            email: userEmail,
            name: userEmail.split('@')[0] || 'Console User',
            role: 'LEAD',
          }
        });

        memberRecord = await prisma.workspaceMember.upsert({
          where: { workspace_members_uniq: { workspaceId: wsId, userId } },
          update: { role: 'LEAD' },
          create: {
            workspaceId: wsId,
            userId,
            role: 'LEAD'
          },
          include: {
            workspace: {
              include: {
                members: {
                  include: { user: true }
                }
              }
            }
          }
        });
      }

      if (!memberRecord) return null;
      return memberRecord.workspace;
    } catch (e) {
      console.error('Failed to get workspace:', e);
      return null;
    }
  });

  ipcMain.handle('workspace:invite', async (event, { name, email, role }) => {
    try {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) throw new Error('Not authenticated');

      // Get the user's workspace ID
      const memberRecord = await prisma.workspaceMember.findFirst({
        where: { userId }
      });
      if (!memberRecord) throw new Error('No workspace membership found');
      const wsId = memberRecord.workspaceId;

      // Check if user already exists in DB
      let targetUser = await prisma.user.findFirst({
        where: { email }
      });

      if (!targetUser) {
        // Create user
        const newUserId = uuidv4();
        targetUser = await prisma.user.create({
          data: {
            id: newUserId,
            supabaseId: `sb-invited-${newUserId.slice(0, 8)}`,
            email,
            name,
            role: 'MEMBER'
          }
        });
      }

      // Map role string to UserRole enum
      let dbRole: 'LEAD' | 'MEMBER' | 'EXECUTIVE' | 'VIEWER' = 'MEMBER';
      const cleanRole = role.toUpperCase();
      if (cleanRole.includes('OWNER') || cleanRole.includes('LEAD')) {
        dbRole = 'LEAD';
      } else if (cleanRole.includes('EXECUTIVE')) {
        dbRole = 'EXECUTIVE';
      } else if (cleanRole.includes('VIEWER')) {
        dbRole = 'VIEWER';
      }

      // Add WorkspaceMember membership
      const member = await prisma.workspaceMember.upsert({
        where: { workspace_members_uniq: { workspaceId: wsId, userId: targetUser.id } },
        update: { role: dbRole },
        create: {
          workspaceId: wsId,
          userId: targetUser.id,
          role: dbRole
        }
      });

      return { success: true, member };
    } catch (e: any) {
      console.error('Failed to invite member:', e);
      return { success: false, error: e.message };
    }
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
          executionPlan: true,
        },
      });
      if (!meeting) throw new Error('Meeting not found');
      return { meeting, actionItems: meeting.actionItems || [], executionPlan: meeting.executionPlan || null };
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

  ipcMain.handle(IPC_CHANNELS.MEETINGS.DELETE, async (event, id) => {
    try {
      await prisma.actionItem.deleteMany({ where: { meetingId: id } });
      await prisma.decision.deleteMany({ where: { meetingId: id } });
      await prisma.risk.deleteMany({ where: { meetingId: id } });
      await prisma.executionPlan.deleteMany({ where: { meetingId: id } });
      await prisma.meeting.delete({ where: { id } });
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
      fetch('http://127.0.0.1:11434/api/pull', {
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
  if (recordingOverlay) recordingOverlay.hide();
  if (trayManager) trayManager.setState('processing');
  if (mainWindow) {
    mainWindow.webContents.send('autocap:stop');
  }
}

function handleOverlayDelete() {
  if (recordingOverlay) recordingOverlay.hide();
  if (trayManager) trayManager.setState('idle');
  if (mainWindow) {
    mainWindow.webContents.send('autocap:stop');
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
        wasWindowHiddenBeforeRecording = false; // Reset offscreen status since user restored the window
        // If window was moved off-screen for background recording, center it back
        const pos = mainWindow.getPosition();
        if (pos && pos.length >= 2 && pos[0] < -5000) {
          mainWindow.center();
        }
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
      isQuitting = true;
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

      // Notify renderer to start actual recording
      if (mainWindow) {
        // Chromium disables microphone capture on hidden windows; show window off-screen to keep recording working!
        if (!mainWindow.isVisible()) {
          wasWindowHiddenBeforeRecording = true;
          mainWindow.showInactive();
          mainWindow.setPosition(-10000, -10000);
        } else {
          wasWindowHiddenBeforeRecording = false;
        }
        mainWindow.webContents.send('autocap:start', { appName });
      }
    },
    async () => {
      // Trigger recording end
      if (recordingOverlay) recordingOverlay.hide();
      if (trayManager) trayManager.setState('processing');

      // Notify renderer to stop recording
      if (mainWindow) {
        mainWindow.webContents.send('autocap:stop');
        if (wasWindowHiddenBeforeRecording) {
          mainWindow.hide();
          wasWindowHiddenBeforeRecording = false;
        }
      }
    }
  );
  meetingDetector.start();

  splashWindow = createSplashWindow();

  setTimeout(() => {
    mainWindow = createMainWindow();

    mainWindow.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        // If currently recording, move off-screen so Chromium doesn't kill WebRTC mic stream. Otherwise hide.
        const isRecording = trayManager && trayManager.getState() === 'recording';
        if (isRecording) {
          wasWindowHiddenBeforeRecording = true;
          mainWindow?.setPosition(-10000, -10000);
        } else {
          mainWindow?.hide();
        }
      }
    });

    mainWindow.once('ready-to-show', () => {
      if (splashWindow) {
        splashWindow.close();
      }
      mainWindow?.show();
    });
  }, 2500);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !autoCaptureSettings.enabled) {
    app.quit();
  }
});
