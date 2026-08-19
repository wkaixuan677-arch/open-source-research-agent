export type Phase = "PLAN" | "ACT" | "VERIFY" | "REPLAN" | "FINALIZE";

export interface ResearchTask {
  objective: string;
  requiredProjects: string[];
  requiredFields: Array<"license" | "language" | "features" | "limitations">;
  maxToolCalls: number;
  maxReplans: number;
}

export interface ProjectRecord {
  name: string;
  language: string;
  license: string;
  features: string[];
  limitations: string[];
  sourceUrl: string;
}

export interface Evidence {
  id: string;
  project: string;
  field: string;
  value: string;
  sourceUrl: string;
}

export interface TraceEvent {
  phase: Phase;
  detail: string;
  tool?: string;
  evidenceIds?: string[];
}

export interface ResearchResult {
  status: "COMPLETED" | "PARTIAL" | "BLOCKED";
  report: string;
  evidence: Evidence[];
  trace: TraceEvent[];
  toolCalls: number;
  replans: number;
}
