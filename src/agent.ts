import { reviewEvidence } from "./reviewer.js";
import { DeterministicPlanner } from "./planner.js";
import { ResearchToolError } from "./tools.js";
import type { Evidence, ProjectRecord, ResearchPlanner, ResearchResult, ResearchRunOptions, ResearchTask, ResearchToolset, TraceEvent } from "./types.js";

function toEvidence(record: ProjectRecord): Evidence[] {
  const values: Record<string, string> = {
    language: record.language,
    license: record.license,
    features: record.features.join("；"),
    limitations: record.limitations.join("；")
  };
  return Object.entries(values).map(([field, value]) => ({
    id: `${record.name.toLowerCase()}-${field}`,
    project: record.name,
    field,
    value,
    sourceUrl: record.sourceUrl
  }));
}

class EvidenceIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceIntegrityError";
  }
}

function assertUniqueEvidenceIds(existing: Evidence[], incoming: Evidence[] = []): void {
  const seen = new Set<string>();
  for (const item of [...existing, ...incoming]) {
    if (seen.has(item.id)) {
      throw new EvidenceIntegrityError(`duplicate_evidence_id:${item.id}`);
    }
    seen.add(item.id);
  }
}

function buildReport(task: ResearchTask, evidence: Evidence[]): string {
  const sections = task.requiredProjects.map((project) => {
    const rows = evidence.filter((item) => item.project === project);
    return [`## ${project}`, ...rows.map((row) => `- ${row.field}: ${row.value} [${row.id}]`)].join("\n");
  });
  return [`# 开源项目调研报告`, ``, `目标：${task.objective}`, ``, ...sections].join("\n");
}

export async function runResearchAgent(
  task: ResearchTask,
  tools: ResearchToolset,
  planner: ResearchPlanner = new DeterministicPlanner(),
  options: ResearchRunOptions = {},
): Promise<ResearchResult> {
  validateTask(task);
  throwIfCancelled(options.signal);
  const trace: TraceEvent[] = [{ phase: "PLAN", detail: "先校验显式目标，再根据可执行目标生成证据采集计划", planRevision: 0 }];
  const evidence: Evidence[] = [];
  let toolCalls = 0;
  let replans = 0;

  const discovered = await tools.searchProjects(task.requiredProjects, options.signal);
  throwIfCancelled(options.signal);
  toolCalls += 1;
  trace.push({ phase: "ACT", tool: "search_projects", detail: `校验 ${discovered.length} 个显式目标` });
  let plan = await planner.createPlan(task, discovered, { signal: options.signal });
  throwIfCancelled(options.signal);
  trace.push({ phase: "PLAN", detail: plan.rationale, planRevision: plan.revision });

  for (const step of plan.steps) {
    const name = step.project;
    let inspected = false;
    while (!inspected && toolCalls < task.maxToolCalls) {
      const currentStep = plan.steps.find((item) => item.project === name)!;
      currentStep.status = "IN_PROGRESS";
      try {
        throwIfCancelled(options.signal);
        const record = await tools.inspectProject(name, options.signal);
        throwIfCancelled(options.signal);
        toolCalls += 1;
        const items = toEvidence(record).filter((item) => task.requiredFields.includes(item.field as ResearchTask["requiredFields"][number]));
        assertUniqueEvidenceIds(evidence, items);
        evidence.push(...items);
        trace.push({ phase: "ACT", tool: "inspect_project", detail: `读取 ${name}`, evidenceIds: items.map((item) => item.id) });
        currentStep.status = "COMPLETED";
        inspected = true;
      } catch (error) {
        if (error instanceof EvidenceIntegrityError) {
          throw error;
        }
        if (error instanceof ResearchToolError && error.code === "ABORTED") {
          throw error;
        }
        if (options.signal?.aborted) {
          throw new ResearchToolError("ABORTED", false, "research_run_aborted");
        }
        toolCalls += 1;
        const retryable = error instanceof ResearchToolError && error.retryable;
        if (!retryable || replans >= task.maxReplans) {
          currentStep.status = "FAILED";
          break;
        }
        replans += 1;
        plan = await planner.revisePlan(plan, name, error.message, { signal: options.signal });
        throwIfCancelled(options.signal);
        trace.push({ phase: "REPLAN", detail: plan.rationale, planRevision: plan.revision });
      }
    }
  }

  throwIfCancelled(options.signal);
  assertUniqueEvidenceIds(evidence);
  const citations = evidence.map((item) => item.id);
  const review = reviewEvidence(task, evidence, citations);
  trace.push({ phase: "VERIFY", detail: review.accepted ? "证据覆盖和引用校验通过" : `缺失：${review.missing.join(", ")}` });
  const report = buildReport(task, evidence);
  const status = review.accepted ? "COMPLETED" : evidence.length > 0 ? "PARTIAL" : "BLOCKED";
  trace.push({ phase: "FINALIZE", detail: `以 ${status} 状态结束` });
  return { status, report, evidence, trace, toolCalls, replans, plan, review };
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ResearchToolError("ABORTED", false, "research_run_aborted");
}

function validateTask(task: ResearchTask): void {
  if (!task.objective.trim()) throw new Error("objective must not be empty");
  if (!Number.isInteger(task.maxToolCalls) || task.maxToolCalls < 1) throw new Error("maxToolCalls must be a positive integer");
  if (!Number.isInteger(task.maxReplans) || task.maxReplans < 0) throw new Error("maxReplans must be a non-negative integer");
  if (!Array.isArray(task.requiredProjects) || task.requiredProjects.length === 0) {
    throw new Error("requiredProjects must not be empty");
  }
  if (!Array.isArray(task.requiredFields) || task.requiredFields.length === 0) {
    throw new Error("requiredFields must not be empty");
  }
  if (task.requiredProjects.some((project) => !project.trim() || project !== project.trim())) {
    throw new Error("requiredProjects must contain non-empty normalized names");
  }
  const projectIdentities = task.requiredProjects.map(normalizeProjectIdentity);
  if (new Set(projectIdentities).size !== projectIdentities.length) {
    throw new Error("requiredProjects must be unique after identity normalization");
  }
  if (new Set(task.requiredFields).size !== task.requiredFields.length) throw new Error("requiredFields must be unique");
}

function normalizeProjectIdentity(project: string): string {
  const normalized = project.trim();
  if (!normalized.includes("://")) return normalized.toLowerCase();

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
    if (url.protocol === "https:" && url.hostname === "github.com" && segments.length === 2) {
      return `${segments[0]}/${segments[1]}`.toLowerCase();
    }
    if (
      url.protocol === "https:"
      && url.hostname === "api.github.com"
      && segments.length === 3
      && segments[0] === "repos"
    ) {
      return `${segments[1]}/${segments[2]}`.toLowerCase();
    }
  } catch {
    // Invalid targets are still normalized deterministically here and rejected
    // by the selected tool adapter before any network request.
  }
  return normalized.toLowerCase();
}
