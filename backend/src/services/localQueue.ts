import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const QUEUE_DIR = path.resolve(env.UPLOAD_DIR || './uploads', 'sync_queue');

// Ensure queue directory exists
if (!fs.existsSync(QUEUE_DIR)) {
  fs.mkdirSync(QUEUE_DIR, { recursive: true });
}

export interface QueuedMeeting {
  meetingId: string;
  workspaceId: string;
  title: string;
  transcript: string;
  duration: number;
  participantNames: string[];
  projectTags: string[];
  userId: string;
  extractedData: {
    summary: string;
    decisions: any[];
    actionItems: any[];
    risks: any[];
  };
  validationResults: any[];
}

/**
 * Queue a completed meeting locally when offline.
 */
export async function queueOfflineMeeting(meeting: QueuedMeeting): Promise<void> {
  const filePath = path.join(QUEUE_DIR, `${meeting.meetingId}.json`);
  fs.writeFileSync(filePath, JSON.stringify(meeting, null, 2), 'utf-8');
  logger.info(`Queued meeting ${meeting.meetingId} locally for sync`, { title: meeting.title });
}

/**
 * List all queued meetings.
 */
export async function getQueuedMeetings(): Promise<QueuedMeeting[]> {
  try {
    const files = fs.readdirSync(QUEUE_DIR);
    const meetings: QueuedMeeting[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const content = fs.readFileSync(path.join(QUEUE_DIR, file), 'utf-8');
        meetings.push(JSON.parse(content));
      }
    }
    return meetings;
  } catch (error) {
    logger.error('Failed to read sync queue', { error });
    return [];
  }
}

/**
 * Remove meeting from local queue after successful sync.
 */
export async function dequeueMeeting(meetingId: string): Promise<void> {
  const filePath = path.join(QUEUE_DIR, `${meetingId}.json`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    logger.info(`Dequeued and deleted local queue file for meeting ${meetingId}`);
  }
}
