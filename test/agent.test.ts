import assert from "node:assert/strict";
import test from "node:test";
import { runResearchAgent } from "../src/agent.js";
import { FIXTURE_PROJECTS } from "../src/fixtures.js";
import { reviewEvidence } from "../src/reviewer.js";
import { LocalResearchTools } from "../src/tools.js";
import type { ResearchTask } from "../src/types.js";

const task: ResearchTask = {
  objective: "比较开源项目",
  requiredProjects: ["Trailblazer", "EvidenceKit"],
  requiredFields: ["license", "language", "features", "limitations"],
  maxToolCalls: 6,
  maxReplans: 1
};

test("证据完整时生成完成状态", async () => {
  const result = await runResearchAgent(task, new LocalResearchTools(FIXTURE_PROJECTS));
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.evidence.length, 8);
});

test("瞬时工具失败后进行有界重规划", async () => {
  const result = await runResearchAgent(task, new LocalResearchTools(FIXTURE_PROJECTS, 1));
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.replans, 1);
});

test("审查器拒绝不存在的引用", () => {
  const review = reviewEvidence(task, [], ["invented-evidence"]);
  assert.equal(review.accepted, false);
  assert.deepEqual(review.unsupportedCitations, ["invented-evidence"]);
});

test("预算不足时安全输出部分结果", async () => {
  const result = await runResearchAgent({ ...task, maxToolCalls: 2 }, new LocalResearchTools(FIXTURE_PROJECTS));
  assert.equal(result.status, "PARTIAL");
});
