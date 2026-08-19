import assert from "node:assert/strict";
import test from "node:test";
import { runResearchAgent } from "../src/agent.js";
import { FIXTURE_PROJECTS } from "../src/fixtures.js";
import { reviewEvidence } from "../src/reviewer.js";
import { LocalResearchTools, ResearchToolError } from "../src/tools.js";
import type { ResearchPlanner, ResearchTask, ResearchToolset } from "../src/types.js";

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

test("非规范化项目名在执行前被拒绝", async () => {
  await assert.rejects(
    () => runResearchAgent({ ...task, requiredProjects: [" Trailblazer"] }, new LocalResearchTools(FIXTURE_PROJECTS)),
    /normalized names/,
  );
});

test("项目身份按大小写和 GitHub 规范 URL 去重", async () => {
  await assert.rejects(
    () => runResearchAgent(
      { ...task, requiredProjects: ["Trailblazer", "trailblazer"] },
      new LocalResearchTools(FIXTURE_PROJECTS),
    ),
    /unique after identity normalization/,
  );
  await assert.rejects(
    () => runResearchAgent(
      {
        ...task,
        requiredProjects: [
          "octocat/Hello-World",
          "https://api.github.com/repos/OCTOCAT/hello-world",
        ],
      },
      new LocalResearchTools(FIXTURE_PROJECTS),
    ),
    /unique after identity normalization/,
  );
});

test("工具返回重复 Evidence ID 时拒绝生成歧义报告", async () => {
  const duplicateRecord = { ...FIXTURE_PROJECTS[0]!, name: "SameProject" };
  const tools: ResearchToolset = {
    searchProjects(names) {
      return names;
    },
    inspectProject() {
      return structuredClone(duplicateRecord);
    },
  };
  await assert.rejects(
    () => runResearchAgent({
      ...task,
      requiredProjects: ["Alpha", "Beta"],
      requiredFields: ["language"],
    }, tools),
    /duplicate_evidence_id:sameproject-language/,
  );
});

test("空项目或空字段任务在执行前被拒绝", async () => {
  await assert.rejects(
    () => runResearchAgent({ ...task, requiredProjects: [] }, new LocalResearchTools(FIXTURE_PROJECTS)),
    /requiredProjects must not be empty/,
  );
  await assert.rejects(
    () => runResearchAgent({ ...task, requiredFields: [] }, new LocalResearchTools(FIXTURE_PROJECTS)),
    /requiredFields must not be empty/,
  );
});

test("工具返回结果前发生的取消不会被接受", async () => {
  const controller = new AbortController();
  const tools: ResearchToolset = {
    searchProjects(names) {
      controller.abort("cancelled_during_search");
      return names;
    },
    inspectProject() {
      throw new Error("inspectProject should not run");
    },
  };
  await assert.rejects(
    () => runResearchAgent(task, tools, undefined, { signal: controller.signal }),
    (error) => error instanceof ResearchToolError && error.code === "ABORTED",
  );
});

test("Planner 收到 signal 且其返回前发生的取消不会被接受", async () => {
  const controller = new AbortController();
  const planner: ResearchPlanner = {
    createPlan(_task, _projects, context) {
      assert.equal(context?.signal, controller.signal);
      controller.abort("cancelled_during_planning");
      return { revision: 1, rationale: "cancelled", steps: [] };
    },
    revisePlan(plan) {
      return plan;
    },
  };
  await assert.rejects(
    () => runResearchAgent(task, new LocalResearchTools(FIXTURE_PROJECTS), planner, { signal: controller.signal }),
    (error) => error instanceof ResearchToolError && error.code === "ABORTED",
  );
});

test("inspectProject 返回记录前发生的取消不会生成完成结果", async () => {
  const controller = new AbortController();
  const tools: ResearchToolset = {
    searchProjects(names) {
      return names;
    },
    inspectProject() {
      controller.abort("cancelled_during_inspection");
      return structuredClone(FIXTURE_PROJECTS[0]!);
    },
  };
  await assert.rejects(
    () => runResearchAgent({ ...task, requiredProjects: ["Trailblazer"] }, tools, undefined, { signal: controller.signal }),
    (error) => error instanceof ResearchToolError && error.code === "ABORTED",
  );
});

test("重规划收到 signal 且其返回前发生的取消不会被吞掉", async () => {
  const controller = new AbortController();
  const planner: ResearchPlanner = {
    createPlan() {
      return {
        revision: 1,
        rationale: "initial",
        steps: [{ project: "Trailblazer", status: "PENDING", strategy: "inspect", attempt: 0 }],
      };
    },
    revisePlan(plan, _project, _reason, context) {
      assert.equal(context?.signal, controller.signal);
      controller.abort("cancelled_during_replan");
      return { ...plan, revision: 2, rationale: "cancelled" };
    },
  };
  await assert.rejects(
    () => runResearchAgent(
      { ...task, requiredProjects: ["Trailblazer"] },
      new LocalResearchTools(FIXTURE_PROJECTS, 1),
      planner,
      { signal: controller.signal },
    ),
    (error) => error instanceof ResearchToolError && error.code === "ABORTED",
  );
});
