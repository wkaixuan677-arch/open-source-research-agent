import { reviewEvidence } from "./reviewer.js";
import { DeterministicPlanner } from "./planner.js";
import { ResearchToolError } from "./tools.js";
import type { Evidence, ProjectRecord, ResearchPlanner, ResearchResult, ResearchTask, ResearchToolset, TraceEvent } from "./types.js";

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

function buildReport(task: ResearchTask, evidence: Evidence[]): string {
  const sections = task.requiredProjects.map((project) => {
    const rows = evidence.filter((item) => item.project === project);
    return [`## ${project}`, ...rows.map((row) => `- ${row.field}: ${row.value} [${row.id}]`)].join("\n");
  });
  return [`# 开源项目调研报告`, ``, `目标：${task.objective}`, ``, ...sections].join("\n");
}

export async function runResearchAgent(task: ResearchTask, tools: ResearchToolset, planner: ResearchPlanner = new DeterministicPlanner()): Promise<ResearchResult> {
  validateTask(task);
  const trace: TraceEvent[] = [{ phase: "PLAN", detail: "先搜索候选项目，再根据实际发现结果生成可执行计划", planRevision: 0 }];
  const evidence: Evidence[] = [];
  let toolCalls = 0;
  let replans = 0;

  const discovered = await tools.searchProjects(task.requiredProjects);
  toolCalls += 1;
  trace.push({ phase: "ACT", tool: "search_projects", detail: `发现 ${discovered.length} 个候选项目` });
  let plan = await planner.createPlan(task, discovered);
  trace.push({ phase: "PLAN", detail: plan.rationale, planRevision: plan.revision });

  for (const step of plan.steps) {
    const name = step.project;
    let inspected = false;
    while (!inspected && toolCalls < task.maxToolCalls) {
      const currentStep = plan.steps.find((item) => item.project === name)!;
      currentStep.status = "IN_PROGRESS";
      try {
        const record = await tools.inspectProject(name);
        toolCalls += 1;
        const items = toEvidence(record).filter((item) => task.requiredFields.includes(item.field as ResearchTask["requiredFields"][number]));
        evidence.push(...items);
        trace.push({ phase: "ACT", tool: "inspect_project", detail: `读取 ${name}`, evidenceIds: items.map((item) => item.id) });
        currentStep.status = "COMPLETED";
        inspected = true;
      } catch (error) {
        toolCalls += 1;
        const retryable = error instanceof ResearchToolError && error.retryable;
        if (!retryable || replans >= task.maxReplans) {
          currentStep.status = "FAILED";
          break;
        }
        replans += 1;
        plan = await planner.revisePlan(plan, name, error.message);
        trace.push({ phase: "REPLAN", detail: plan.rationale, planRevision: plan.revision });
      }
    }
  }

  const citations = evidence.map((item) => item.id);
  const review = reviewEvidence(task, evidence, citations);
  trace.push({ phase: "VERIFY", detail: review.accepted ? "证据覆盖和引用校验通过" : `缺失：${review.missing.join(", ")}` });
  const report = buildReport(task, evidence);
  const status = review.accepted ? "COMPLETED" : evidence.length > 0 ? "PARTIAL" : "BLOCKED";
  trace.push({ phase: "FINALIZE", detail: `以 ${status} 状态结束` });
  return { status, report, evidence, trace, toolCalls, replans, plan, review };
}

function validateTask(task: ResearchTask): void {
  if (!task.objective.trim()) throw new Error("objective must not be empty");
  if (!Number.isInteger(task.maxToolCalls) || task.maxToolCalls < 1) throw new Error("maxToolCalls must be a positive integer");
  if (!Number.isInteger(task.maxReplans) || task.maxReplans < 0) throw new Error("maxReplans must be a non-negative integer");
  if (new Set(task.requiredProjects).size !== task.requiredProjects.length) throw new Error("requiredProjects must be unique");
  if (new Set(task.requiredFields).size !== task.requiredFields.length) throw new Error("requiredFields must be unique");
}
