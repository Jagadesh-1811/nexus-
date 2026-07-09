export interface Meeting {
  id: string;
  title: string;
  date: string;
  participants: string[];
  transcript: string;
}

export interface ActionItem {
  id: string;
  description: string;
  assignee: string;
  deadline: string;
  status: 'draft' | 'validated' | 'flagged' | 'refined' | 'dispatched';
  objection?: string;
  snippet?: string;
}

export interface IngestProgress {
  stage: 'Transcribing' | 'Extracting' | 'Cross-referencing memory' | 'Validating' | 'Complete';
  progress: number; // 0 to 100
  message: string;
}

export interface SystemResources {
  cpu: number;
  ram: number;
}
