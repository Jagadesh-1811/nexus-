/**
 * TRANSCRIPTION TOOL
 * 
 * Uses Deepgram Nova-2 for high-fidelity audio-to-text transcription
 * with speaker diarization and confidence scoring.
 */

import { createTool } from '@mastra/core/tools';
import { createClient } from '@deepgram/sdk';
import { z } from 'zod';
import fs from 'fs';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const deepgram = createClient(env.DEEPGRAM_API_KEY);

export const transcriptionTool = createTool({
  id: 'transcription',
  description: 'Transcribes an audio/video file to text using Deepgram Nova-2 with speaker diarization',
  inputSchema: z.object({
    audioFilePath: z.string().describe('Absolute path to the audio/video file'),
    language: z.string().default('en').describe('Language code (default: en)'),
  }),
  outputSchema: z.object({
    transcript: z.string(),
    speakers: z.array(z.object({
      speaker: z.number(),
      words: z.array(z.object({
        word: z.string(),
        start: z.number(),
        end: z.number(),
        confidence: z.number(),
      })),
    })),
    confidence: z.number(),
    duration: z.number(),
    words: z.number(),
  }),
  execute: async ({ context }) => {
    const { audioFilePath, language } = context;
    logger.info('Starting transcription', { audioFilePath });

    try {
      const audioBuffer = fs.readFileSync(audioFilePath);

      const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
        audioBuffer,
        {
          model: 'nova-2',
          language,
          smart_format: true,
          diarize: true,
          punctuate: true,
          utterances: true,
          paragraphs: true,
          filler_words: false,
          detect_language: true,
        }
      );

      if (error || !result) {
        throw new Error(`Deepgram transcription failed: ${error?.message}`);
      }

      const channel = result.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];

      if (!alternative) {
        throw new Error('No transcription alternative returned');
      }

      const transcript = alternative.transcript ?? '';
      const confidence = alternative.confidence ?? 0;
      const duration = result.metadata?.duration ?? 0;
      const words = alternative.words?.length ?? 0;

      // Group words by speaker for diarization output
      const speakerMap = new Map<number, typeof alternative.words>();
      for (const word of (alternative.words ?? [])) {
        const speakerId = word.speaker ?? 0;
        if (!speakerMap.has(speakerId)) speakerMap.set(speakerId, []);
        speakerMap.get(speakerId)!.push(word);
      }

      const speakers = Array.from(speakerMap.entries()).map(([speaker, speakerWords]) => ({
        speaker,
        words: speakerWords.map(w => ({
          word: w.word ?? '',
          start: w.start ?? 0,
          end: w.end ?? 0,
          confidence: w.confidence ?? 0,
        })),
      }));

      logger.info('Transcription completed', {
        duration,
        words,
        confidence,
        speakerCount: speakers.length,
      });

      return { transcript, speakers, confidence, duration, words };
    } catch (error) {
      logger.error('Transcription failed', { error, audioFilePath });
      throw error;
    }
  },
});
