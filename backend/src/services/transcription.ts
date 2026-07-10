import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient as createDeepgramClient } from '@deepgram/sdk';
import { env } from '../config/env';
import { logger } from '../config/logger';

const execAsync = promisify(exec);

export interface TranscriptionResult {
  transcript: string;
  duration: number;
}

/**
 * Transcribe meeting audio file.
 * Automatically chooses between local offline Whisper and cloud Deepgram.
 */
export async function transcribeAudio(
  filePath: string,
  provider?: 'whisper' | 'deepgram'
): Promise<TranscriptionResult> {


  const activeProvider = provider || (env.DEEPGRAM_API_KEY ? 'deepgram' : 'whisper');
  logger.info(`Starting transcription with provider: ${activeProvider} for file: ${filePath}`);

  if (activeProvider === 'deepgram') {
    return transcribeWithDeepgram(filePath);
  } else {
    return transcribeWithLocalWhisper(filePath);
  }
}

/**
 * Cloud Deepgram transcription
 */
async function transcribeWithDeepgram(filePath: string): Promise<TranscriptionResult> {
  if (!env.DEEPGRAM_API_KEY) {
    throw new Error('Deepgram API key not configured in .env file (DEEPGRAM_API_KEY)');
  }

  const deepgram = createDeepgramClient(env.DEEPGRAM_API_KEY);
  const audioBuffer = fs.readFileSync(filePath);
  
  const { result, error } = await deepgram.listen.prerecorded.transcribeFile(audioBuffer, {
    model: 'nova-2',
    smart_format: true,
    diarize: true,
    punctuate: true,
  });

  if (error || !result) {
    throw new Error(`Deepgram transcription failed: ${error?.message || 'No result'}`);
  }

  const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  const duration = result.metadata?.duration ?? 0;

  return { transcript, duration };
}

/**
 * Local Offline Whisper (faster-whisper/whisper.cpp)
 */
async function transcribeWithLocalWhisper(filePath: string): Promise<TranscriptionResult> {
  // Check if whisper executable path is configured
  const whisperPath = process.env.WHISPER_CPP_PATH;
  const whisperModel = process.env.WHISPER_CPP_MODEL || 'ggml-base.en.bin';

  if (!whisperPath) {
    throw new Error('WHISPER_CPP_PATH environment variable is not configured. Please install whisper.cpp and set WHISPER_CPP_PATH in your .env file.');
  }

  // Construct command: whisper.exe -m <model> -f <wav_file> -otxt
  // whisper.cpp requires WAV file (16kHz mono), so we assume the file is pre-converted or convert it
  const outputTxtPath = `${filePath}.txt`;
  const cmd = `"${whisperPath}" -m "${whisperModel}" -f "${filePath}" -otxt`;
  
  logger.info(`Executing local whisper: ${cmd}`);
  await execAsync(cmd);
  
  if (fs.existsSync(outputTxtPath)) {
    const transcript = fs.readFileSync(outputTxtPath, 'utf-8');
    const stats = fs.statSync(filePath);
    const duration = Math.round(stats.size / (16000 * 2)); // 16kHz 16-bit mono WAV estimation
    
    // Cleanup
    try { fs.unlinkSync(outputTxtPath); } catch {}
    
    return { transcript, duration };
  } else {
    throw new Error('Whisper output text file not generated');
  }
}
