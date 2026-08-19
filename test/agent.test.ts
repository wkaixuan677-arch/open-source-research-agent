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
  assert.equal(result.plan.revision, 2);
  assert.equal(result.plan.steps[0]?.strategy, "retry_after_transient_failure");
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

test("搜索未发现的项目不会被虚构为可执行步骤", async () => {
  const result = await runResearchAgent({ ...task, requiredProjects: ["Trailblazer", "MissingProject"] }, new LocalResearchTools(FIXTURE_PROJECTS));
  assert.equal(result.status, "PARTIAL");
  assert.deepEqual(result.plan.steps.map((step) => step.project), ["Trailblazer"]);
  assert.ok(result.review.missing.some((item) => item.startsWith("MissingProject.")));
});

test("非法预算在执行前被拒绝", async () => {
  await assert.rejects(() => runResearchAgent({ ...task, maxToolCalls: 0 }, new LocalResearchTools(FIXTURE_PROJECTS)), /positive integer/);
});
