import { mkdir, writeFile } from "node:fs/promises";
import { runResearchAgent } from "./agent.js";
import { FIXTURE_PROJECTS } from "./fixtures.js";
import { LocalResearchTools } from "./tools.js";
import type { ResearchTask } from "./types.js";

const task: ResearchTask = {
  objective: "比较两个 Agent 工程项目的语言、许可证、能力和限制",
  requiredProjects: ["Trailblazer", "EvidenceKit"],
  requiredFields: ["language", "license", "features", "limitations"],
  maxToolCalls: 6,
  maxReplans: 1
};

const result = await runResearchAgent(task, new LocalResearchTools(FIXTURE_PROJECTS, 1));
await mkdir("reports", { recursive: true });
await writeFile("reports/demo-result.json", JSON.stringify(result, null, 2), "utf8");
console.log(`状态：${result.status}`);
console.log(`证据：${result.evidence.length} 条；工具调用：${result.toolCalls}；重规划：${result.replans}`);
console.log("阶段：" + result.trace.map((event) => event.phase).join(" → "));
console.log("报告：reports/demo-result.json");
