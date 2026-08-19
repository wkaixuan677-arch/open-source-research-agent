import type { Evidence, ResearchTask } from "./types.js";

export interface Review {
  accepted: boolean;
  missing: string[];
  unsupportedCitations: string[];
}

export function reviewEvidence(task: ResearchTask, evidence: Evidence[], citations: string[]): Review {
  const ids = new Set(evidence.map((item) => item.id));
  const unsupportedCitations = citations.filter((id) => !ids.has(id));
  const missing: string[] = [];
  for (const project of task.requiredProjects) {
    for (const field of task.requiredFields) {
      if (!evidence.some((item) => item.project === project && item.field === field)) {
        missing.push(`${project}.${field}`);
      }
    }
  }
  return { accepted: missing.length === 0 && unsupportedCitations.length === 0, missing, unsupportedCitations };
}
