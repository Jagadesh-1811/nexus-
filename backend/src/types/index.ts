/**
 * Shared TypeScript interfaces across the Synapse system
 */

// ============================================================
// Meeting Pipeline
// ============================================================

export type MeetingStatus =
  | 'PENDING'
  | 'TRANSCRIBING'
  | 'ANALYZING'
  | 'VALIDATING'
  | 'COMPLETED'
  | 'FAILED';

export type ActionItemStatus =
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'JIRA_CREATED'
  | 'SLACK_NOTIFIED'
  | 'COMPLETED';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type UserRole = 'ADMIN' | 'PROJECT_MANAGER' | 'ENGINEER_LEAD' | 'EXECUTIVE' | 'VIEWER';

// ============================================================
// Extraction Results (from GPT-4o)
// ============================================================

export interface ExtractedDecision {
  title: string;
  context: string;
  impact: string;
  stakeholders: string[];
  reversible: boolean;
}

export interface ExtractedActionItem {
  id: string;
  description: string;
  assignee: string;
  deadline: string | null;
  priority: Priority;
}

export interface ExtractedRisk {
  description: string;
  level: Priority;
  mitigationSteps?: string;
  owner?: string;
}

export interface ExtractionResult {
  summary: string;
  decisions: ExtractedDecision[];
  actionItems: ExtractedActionItem[];
  risks: ExtractedRisk[];
}

// ============================================================
// Enkrypt Validation
// ============================================================

export interface ValidationResult {
  item: ExtractedActionItem;
  isValid: boolean;
  confidenceScore: number;
  hallucFlags: string[];
  refinementCount: number;
  enkryptReport: Record<string, unknown>;
}

// ============================================================
// Pipeline Events (WebSocket)
// ============================================================

export type PipelineStepId =
  | 'transcribe'
  | 'queryMemory'
  | 'extract'
  | 'validate'
  | 'persist'
  | 'indexVectors'
  | 'followUp';

export type PipelineStepStatus = 'pending' | 'running' | 'complete' | 'failed' | 'awaiting_approval';

export interface PipelineEvent {
  meetingId: string;
  step: PipelineStepId;
  status: PipelineStepStatus;
  data?: Record<string, unknown>;
  timestamp: string;
}

// ============================================================
// API Responses
// ============================================================

export interface ApiError {
  error: string;
  code: string;
  requestId?: string;
  details?: unknown;
}

export interface IngestResponse {
  message: string;
  meetingId: string;
  requestId: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}
