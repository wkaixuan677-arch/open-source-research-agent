export type Phase = "PLAN" | "ACT" | "VERIFY" | "REPLAN" | "FINALIZE";

export interface ResearchTask {
  objective: string;
  requiredProjects: string[];
  requiredFields: Array<"license" | "language" | "features" | "limitations">;
  maxToolCalls: number;
  maxReplans: number;
}

export interface PlanStep {
  project: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  strategy: "inspect" | "retry_after_transient_failure";
  attempt: number;
}

export interface ResearchPlan {
  revision: number;
  rationale: string;
  steps: PlanStep[];
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
  planRevision?: number;
}

export interface ReviewSummary {
  accepted: boolean;
  missing: string[];
  unsupportedCitations: string[];
}

export interface ResearchToolset {
  searchProjects(names: string[]): string[] | Promise<string[]>;
  inspectProject(name: string): ProjectRecord | Promise<ProjectRecord>;
}

export interface ResearchPlanner {
  createPlan(task: ResearchTask, discoveredProjects: string[]): ResearchPlan | Promise<ResearchPlan>;
  revisePlan(plan: ResearchPlan, project: string, reason: string): ResearchPlan | Promise<ResearchPlan>;
}

export interface ResearchResult {
  status: "COMPLETED" | "PARTIAL" | "BLOCKED";
  report: string;
  evidence: Evidence[];
  trace: TraceEvent[];
  toolCalls: number;
  replans: number;
  plan: ResearchPlan;
  review: ReviewSummary;
}
