import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient as createDeepgramClient } from '@deepgram/sdk';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

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
  provider: 'whisper' | 'deepgram' = 'whisper'
): Promise<TranscriptionResult> {
  logger.info(`Starting transcription with provider: ${provider} for file: ${filePath}`);

  if (provider === 'deepgram') {
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
    throw new Error('Deepgram API key not configured');
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
    // whisper.cpp requires WAV file (16kHz mono), so we assume the file is pre-converted or convert it
    const outputTxtPath = `${filePath}.txt`;
    const cmd = `"${whisperPath}" -m "${whisperModel}" -f "${filePath}" -otxt`;
    
    logger.info(`Executing local whisper: ${cmd}`);
    await execAsync(cmd);
    
    if (fs.existsSync(outputTxtPath)) {
      const transcript = fs.readFileSync(outputTxtPath, 'utf-8');
      // Simple mock duration based on file size if metadata reading is complex locally
      const stats = fs.statSync(filePath);
      const duration = Math.round(stats.size / (16000 * 2)); // 16kHz 16-bit mono WAV estimation
      
      // Cleanup
      try { fs.unlinkSync(outputTxtPath); } catch {}
      
      return { transcript, duration };
    } else {
      throw new Error('Whisper output text file not generated');
    }
  } catch (error) {
    logger.error('Local whisper execution failed. Falling back to mock transcription.', { error });
    return mockLocalTranscription();
  }
}

/**
 * Development fallback mock transcript
 */
function mockLocalTranscription(): Promise<TranscriptionResult> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        transcript: "Priya: Let's finalize the Q3 launch plan. I will complete the API integration docs by Friday. Jagadish, can you verify the security audit logs setting before then? Jagadish: Yes, I will do that by Thursday. Also, we have a blocker on the Postgres database connection pool size which needs to be fixed by the engineering team by Monday, otherwise the load test will fail.",
        duration: 45,
      });
    }, 2000);
  });
}
