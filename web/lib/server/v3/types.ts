export type MediaStatus = "pending" | "running" | "done" | "failed" | "archived";
export type RunStatus = "running" | "done" | "failed";
export type RunType = "asr" | "translate" | "segment" | "scan" | "export" | "pipeline";

export type OutputKind = "raw" | "zh" | "bi" | "other";

export type MediaOutput = {
  id: string;
  kind: OutputKind;
  lang?: string;
  path: string;
  updated_at: number;
  size: number;
};

export type MediaOutputs = {
  raw?: MediaOutput;
  zh?: MediaOutput;
  bi?: MediaOutput;
  other: MediaOutput[];
};

export type MediaItem = {
  id: string;
  path: string;
  title: string;
  language?: string;
  status: MediaStatus;
  archived: boolean;
  outputs: MediaOutputs;
  last_run_id?: string;
  created_at: number;
  updated_at: number;
};

export type RunItem = {
  id: string;
  media_id: string;
  type: RunType;
  status: RunStatus;
  started_at: number;
  finished_at?: number;
  error?: string;
  stage?: string;
  log_ref?: string;
};

export type ActivityItem = {
  id: string;
  media_id?: string;
  run_id?: string;
  type: string;
  status: string;
  message: string;
  created_at: number;
  media_title?: string;
  media_path?: string;
  progress?: number | null;
  stage?: string;
  asr_model?: string;
  llm_model?: string;
};

export type StoreState = {
  media: Record<string, MediaItem>;
  runs: Record<string, RunItem>;
  activity: ActivityItem[];
};
