import { reviewEvidence } from "./reviewer.js";
import { LocalResearchTools } from "./tools.js";
import type { Evidence, ProjectRecord, ResearchResult, ResearchTask, TraceEvent } from "./types.js";

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

export async function runResearchAgent(task: ResearchTask, tools: LocalResearchTools): Promise<ResearchResult> {
  const trace: TraceEvent[] = [{ phase: "PLAN", detail: `拆分 ${task.requiredProjects.length} 个项目的证据采集任务` }];
  const evidence: Evidence[] = [];
  let toolCalls = 0;
  let replans = 0;

  const discovered = tools.searchProjects(task.requiredProjects);
  toolCalls += 1;
  trace.push({ phase: "ACT", tool: "search_projects", detail: `发现 ${discovered.length} 个候选项目` });

  for (const name of task.requiredProjects) {
    let inspected = false;
    while (!inspected && toolCalls < task.maxToolCalls) {
      try {
        const record = tools.inspectProject(name);
        toolCalls += 1;
        const items = toEvidence(record).filter((item) => task.requiredFields.includes(item.field as ResearchTask["requiredFields"][number]));
        evidence.push(...items);
        trace.push({ phase: "ACT", tool: "inspect_project", detail: `读取 ${name}`, evidenceIds: items.map((item) => item.id) });
        inspected = true;
      } catch (error) {
        toolCalls += 1;
        if (replans >= task.maxReplans) break;
        replans += 1;
        trace.push({ phase: "REPLAN", detail: `工具失败后调整计划：${String(error)}` });
      }
    }
  }

  const citations = evidence.map((item) => item.id);
  const review = reviewEvidence(task, evidence, citations);
  trace.push({ phase: "VERIFY", detail: review.accepted ? "证据覆盖和引用校验通过" : `缺失：${review.missing.join(", ")}` });
  const report = buildReport(task, evidence);
  const status = review.accepted ? "COMPLETED" : evidence.length > 0 ? "PARTIAL" : "BLOCKED";
  trace.push({ phase: "FINALIZE", detail: `以 ${status} 状态结束` });
  return { status, report, evidence, trace, toolCalls, replans };
}
