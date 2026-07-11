import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { env } from '../config/env';
import { logger } from '../config/logger';

// Only initialize if environment variables are provided
const supabaseUrl = env.SUPABASE_URL || '';
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || '';

export const supabase = (supabaseUrl && supabaseKey) 
  ? createClient(supabaseUrl, supabaseKey) 
  : null;

/**
 * Uploads a local file to a Supabase Storage bucket.
 * 
 * @param filePath The local file path (e.g., from multer)
 * @param filename The destination filename in the bucket
 * @param bucketName The name of the Supabase bucket (defaults to 'recordings')
 * @returns The public URL of the uploaded file, or null if upload fails/is disabled.
 */
export async function uploadRecordingToBucket(
  filePath: string, 
  filename: string, 
  bucketName: string = 'recordings'
): Promise<string | null> {
  if (!supabase) {
    logger.warn('Supabase client not initialized. Skipping bucket upload.');
    return null;
  }

  try {
    const fileBuffer = fs.readFileSync(filePath);
    
    // Upload to Supabase Storage
    const { data, error } = await supabase.storage
      .from(bucketName)
      .upload(filename, fileBuffer, {
        upsert: false,
      });

    if (error) {
      logger.error('Error uploading file to Supabase Storage:', { error });
      return null;
    }

    // Retrieve the public URL for the uploaded file
    const { data: publicUrlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(filename);

    logger.info('Successfully uploaded recording to Supabase Storage.', { filename });
    return publicUrlData.publicUrl;
  } catch (error) {
    logger.error('Failed to upload recording to Supabase bucket', { error });
    return null;
  }
}
