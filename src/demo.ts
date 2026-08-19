import { mkdir, writeFile } from "node:fs/promises";
import { runResearchAgent } from "./agent.js";
import { FIXTURE_PROJECTS } from "./fixtures.js";
import { GitHubPublicResearchTools } from "./github-tools.js";
import { LocalResearchTools } from "./tools.js";
import type { ResearchTask, ResearchToolset } from "./types.js";

const mode = readOption("mode") ?? "fixture";
if (mode !== "fixture" && mode !== "github") {
  throw new Error("--mode must be fixture or github");
}

const projects = mode === "fixture"
  ? ["Trailblazer", "EvidenceKit"]
  : parseGitHubProjects(readOption("projects"));
const tools: ResearchToolset = mode === "fixture"
  ? new LocalResearchTools(FIXTURE_PROJECTS, 1)
  : new GitHubPublicResearchTools();
const task: ResearchTask = {
  objective: mode === "fixture"
    ? "比较两个 Agent 工程项目的语言、许可证、能力和限制"
    : "基于 GitHub 公共仓库元数据比较开源项目",
  requiredProjects: projects,
  requiredFields: ["language", "license", "features", "limitations"],
  maxToolCalls: 1 + projects.length * 2,
  maxReplans: 1
};

const result = await runResearchAgent(task, tools);
await mkdir("reports", { recursive: true });
const reportPath = mode === "fixture" ? "reports/demo-result.json" : "reports/github-demo-result.json";
await writeFile(reportPath, JSON.stringify(result, null, 2), "utf8");
console.log(`模式：${mode}`);
console.log(`状态：${result.status}`);
console.log(`证据：${result.evidence.length} 条；工具调用：${result.toolCalls}；重规划：${result.replans}`);
console.log("阶段：" + result.trace.map((event) => event.phase).join(" → "));
console.log(`报告：${reportPath}`);

function readOption(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseGitHubProjects(rawValue: string | undefined): string[] {
  const values = rawValue?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  if (values.length === 0) {
    throw new Error("GitHub mode requires --projects=owner/repo[,owner/repo]");
  }
  return values;
}
