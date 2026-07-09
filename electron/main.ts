import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import { createMainWindow } from './windows/main-window';
import { createSplashWindow } from './windows/splash-window';
import { IPC_CHANNELS } from './ipc/channels';
import * as os from 'os';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import WebSocket from 'ws';

// Polyfill WebSocket and Fetch globally for Supabase in Electron main process
(global as any).WebSocket = WebSocket;
import fetch from 'cross-fetch';
(global as any).fetch = fetch;

// Load environmental config
const envPath = path.join(__dirname, '../.env');
console.log('__dirname is:', __dirname);
console.log('Loading .env from:', envPath);
const dotenvResult = dotenv.config({ path: envPath });
console.log('dotenv result:', dotenvResult);

const supabaseUrl = process.env.SUPABASE_URL || 'https://placeholder-id.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || 'placeholder-anon-key';
console.log('SUPABASE_URL is:', supabaseUrl);
const supabase = createClient(supabaseUrl, supabaseAnonKey);

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;



let appSettings = {
  theme: 'ink-navy',
  localModel: 'gpt-oss:20b',
  autoStartDocker: true,
  enhancedCloudGate: false
};

function registerIpcHandlers() {
  // Meetings handlers
  ipcMain.handle(IPC_CHANNELS.MEETINGS.LIST, async () => {
    try {
      const { data, error } = await supabase.from('meetings').select('*');
      if (error || !data) return [];
      return data;
    } catch (e) {
      return [];
    }
  });
  ipcMain.handle(IPC_CHANNELS.MEETINGS.GET, async (event, id) => {
    try {
      const { data: meeting, error: err1 } = await supabase.from('meetings').select('*').eq('id', id).single();
      const { data: actionItems, error: err2 } = await supabase.from('action_items').select('*').eq('meeting_id', id);
      if (err1 || !meeting) {
        throw new Error('Meeting not found');
      }
      return { meeting, actionItems: actionItems || [] };
    } catch (e) {
      throw e;
    }
  });
  ipcMain.handle(IPC_CHANNELS.MEETINGS.APPROVE, async (event, id, updates) => {
    try {
      const { error } = await supabase.from('action_items').update(updates).eq('id', id);
      if (error) throw error;
      return { success: true };
    } catch (e) {
      throw e;
    }
  });

  // Ingest
  ipcMain.handle(IPC_CHANNELS.INGEST.UPLOAD, async (event, filePath) => {
    // Just a placeholder for file upload
    return { success: true, message: `File uploaded: ${filePath}` };
  });

  ipcMain.handle('ingest:upload-buffer', async (event, buffer: ArrayBuffer) => {
    try {
      const tempPath = path.join(os.tmpdir(), `nexus-recording-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, Buffer.from(buffer));
      
      event.sender.send(IPC_CHANNELS.INGEST.PROGRESS, { stage: 'Transcribing', progress: 50, message: 'Processing audio...' });
      
      // Simulate real transcription delay
      await new Promise(r => setTimeout(r, 1000));
      const mockTranscript = "This is a transcript automatically generated from the local microphone recording.";
      
      event.sender.send(IPC_CHANNELS.INGEST.PROGRESS, { stage: 'Saving', progress: 90, message: 'Saving to Supabase...' });
      
      const { data: workspaces } = await supabase.from('workspaces').select('id').limit(1);
      if (!workspaces || workspaces.length === 0) {
        throw new Error("No workspace found to save meeting.");
      }

      const { error } = await supabase.from('meetings').insert({
        workspace_id: workspaces[0].id,
        title: `Live Recording ${new Date().toLocaleTimeString()}`,
        transcript_raw: mockTranscript,
        status: 'COMPLETED'
      });
      if (error) throw error;
      
      event.sender.send(IPC_CHANNELS.INGEST.PROGRESS, { stage: 'Complete', progress: 100, message: 'Meeting intelligence extraction complete!' });
      return { success: true, transcript: mockTranscript };
    } catch (e: any) {
      console.error(e);
      throw e;
    }
  });

  // Memory
  ipcMain.handle(IPC_CHANNELS.MEMORY.SEARCH, async (event, query) => {
    const { data, error } = await supabase.from('meetings').select('*').ilike('title', `%${query}%`);
    if (error || !data) return [];
    return data;
  });
  ipcMain.handle(IPC_CHANNELS.MEMORY.ASK, (event, question) => {
    return {
      answer: "Based on the Q3 Strategy Meeting, Bob is assigned to implement the database schema.",
      citations: [{ meetingId: '1', timestamp: '00:15', text: 'Bob: I will implement the Postgres DB schema.' }]
    };
  });

  // Settings
  ipcMain.handle(IPC_CHANNELS.SETTINGS.GET, () => appSettings);
  ipcMain.handle(IPC_CHANNELS.SETTINGS.UPDATE, (event, newSettings) => {
    appSettings = { ...appSettings, ...newSettings };
    return appSettings;
  });
  ipcMain.handle(IPC_CHANNELS.SETTINGS.OLLAMA_STATUS, () => ({ running: true, modelPulled: true }));
  ipcMain.handle(IPC_CHANNELS.SETTINGS.OLLAMA_PULL, () => ({ success: true }));

  // Auth (Email confirmation is disabled in Supabase, returns instant session)
  ipcMain.handle(IPC_CHANNELS.AUTH.GET_SESSION, async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { user: session.user } : null;
  });
  ipcMain.handle(IPC_CHANNELS.AUTH.SIGN_IN, async (event, creds) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: creds.email,
      password: creds.password
    });
    if (error) throw error;
    return { user: data.user, session: data.session };
  });
  ipcMain.handle(IPC_CHANNELS.AUTH.SIGN_UP, async (event, creds) => {
    const { data, error } = await supabase.auth.signUp({
      email: creds.email,
      password: creds.password
    });
    if (error) throw error;
    return { user: data.user, session: data.session };
  });
  ipcMain.handle(IPC_CHANNELS.AUTH.SIGN_OUT, async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { success: true };
  });

  // System
  ipcMain.handle(IPC_CHANNELS.SYSTEM.HEALTH, () => ({ healthy: true }));
  ipcMain.handle(IPC_CHANNELS.SYSTEM.DOCKER_STATUS, () => ({ active: true }));
  ipcMain.handle(IPC_CHANNELS.SYSTEM.RESOURCES, () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    return {
      cpu: Math.round(Math.random() * 20) + 5, // Simulated CPU load
      ram: Math.round((usedMem / totalMem) * 100)
    };
  });

  // Native
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

app.whenReady().then(() => {
  registerIpcHandlers();
  splashWindow = createSplashWindow();

  // Simulate loading services before opening main window
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
