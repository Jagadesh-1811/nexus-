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

  if (!env.DEEPGRAM_API_KEY && !process.env.WHISPER_CPP_PATH) {
    throw new Error('No transcription provider configured (missing DEEPGRAM_API_KEY and WHISPER_CPP_PATH).');
  }

  logger.info(`Starting transcription with provider: ${activeProvider} for file: ${filePath}`);

  if (activeProvider === 'deepgram') {
    try {
      return await transcribeWithDeepgram(filePath);
    } catch (err) {
      logger.warn(`Deepgram transcription failed (e.g. quota exceeded or network issue). Falling back to local Whisper. Error: ${String(err)}`);
      return transcribeWithLocalWhisper(filePath);
    }
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
    logger.warn('WHISPER_CPP_PATH not configured. Falling back to development mock transcription.');
    return mockLocalTranscription();
  }

  try {
    // Construct command: whisper.exe -m <model> -f <wav_file> -otxt
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
  } catch (error) {
    logger.error('Local whisper execution failed.', { error });
    throw error;
  }
}

/**
 * Development fallback mock transcript
 */
function mockLocalTranscription(): Promise<TranscriptionResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        transcript: "User A: Let's finalize the Q3 launch plan. I will complete the API integration docs by Friday. User B, can you verify the security audit logs setting before then? User B: Yes, I will do that by Thursday. Also, we have a blocker on the Postgres database connection pool size which needs to be fixed by the engineering team by Monday, otherwise the load test will fail.",
        duration: 45,
      });
    }, 2000);
  });
}
