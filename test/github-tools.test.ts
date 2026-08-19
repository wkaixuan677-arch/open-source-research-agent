import assert from "node:assert/strict";
import test from "node:test";
import { runResearchAgent } from "../src/agent.js";
import { GITHUB_READ_ONLY_USER_AGENT, GitHubPublicResearchTools } from "../src/github-tools.js";
import { ResearchToolError } from "../src/tools.js";
import type { ResearchTask } from "../src/types.js";

const repositoryPayload = {
  full_name: "octocat/hello-world",
  private: false,
  description: "A public demo repository",
  language: "TypeScript",
  license: { spdx_id: "MIT", name: "MIT License" },
  topics: ["agent", "research"],
  archived: false,
  disabled: false,
  fork: false,
};

function asFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return implementation as typeof fetch;
}

function expectToolError(code: ResearchToolError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof ResearchToolError && error.code === code;
}

test("公共仓库元数据通过固定只读请求进入 Agent 证据链", async () => {
  let calls = 0;
  const fetchImpl = asFetch(async (input, init) => {
    calls += 1;
    assert.equal(String(input), "https://api.github.com/repos/octocat/hello-world");
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("user-agent"), GITHUB_READ_ONLY_USER_AGENT);
    assert.equal(headers.get("authorization"), null);
    return Response.json(repositoryPayload);
  });
  const tools = new GitHubPublicResearchTools({ fetchImpl });
  const task: ResearchTask = {
    objective: "读取公开仓库元数据",
    requiredProjects: ["octocat/hello-world"],
    requiredFields: ["language", "license", "features", "limitations"],
    maxToolCalls: 3,
    maxReplans: 0,
  };

  const result = await runResearchAgent(task, tools);
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.evidence.length, 4);
  assert.equal(result.evidence[0]?.sourceUrl, "https://api.github.com/repos/octocat/hello-world");
  assert.equal(calls, 1);
});

test("404 被分类为不可重试的项目不存在", async () => {
  const tools = new GitHubPublicResearchTools({
    fetchImpl: asFetch(async () => new Response("not found", { status: 404 })),
  });
  await assert.rejects(() => tools.inspectProject("octocat/missing"), (error) => {
    assert.ok(error instanceof ResearchToolError);
    assert.equal(error.retryable, false);
    return error.code === "PROJECT_NOT_FOUND";
  });
});

test("GitHub 限流保留可重试分类和等待时间", async () => {
  const tools = new GitHubPublicResearchTools({
    fetchImpl: asFetch(async () => new Response("rate limited", {
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "retry-after": "2" },
    })),
  });
  await assert.rejects(() => tools.inspectProject("octocat/hello-world"), (error) => {
    assert.ok(error instanceof ResearchToolError);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterMs, 2_000);
    return error.code === "RATE_LIMITED";
  });
});

test("无标准限流头的 403 仍按 GitHub secondary rate limit 处理", async () => {
  const tools = new GitHubPublicResearchTools({
    fetchImpl: asFetch(async () => new Response("secondary rate limit", { status: 403 })),
  });
  await assert.rejects(() => tools.inspectProject("octocat/hello-world"), (error) => {
    assert.ok(error instanceof ResearchToolError);
    assert.equal(error.retryable, true);
    return error.code === "RATE_LIMITED";
  });
});

test("超时会主动取消请求并分类为可重试错误", async () => {
  const fetchImpl = asFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const tools = new GitHubPublicResearchTools({ fetchImpl, timeoutMs: 10 });
  await assert.rejects(() => tools.inspectProject("octocat/hello-world"), (error) => {
    assert.ok(error instanceof ResearchToolError);
    assert.equal(error.retryable, true);
    return error.code === "TIMEOUT";
  });
});

test("调用方 AbortSignal 会停止请求且不会被当成超时", async () => {
  const fetchImpl = asFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const tools = new GitHubPublicResearchTools({ fetchImpl, timeoutMs: 1_000 });
  const pending = tools.inspectProject("octocat/hello-world", controller.signal);
  controller.abort("caller_cancelled");
  await assert.rejects(() => pending, expectToolError("ABORTED"));
});

test("即使 fetch 实现忽略 signal，返回后也不会接受已取消结果", async () => {
  const controller = new AbortController();
  const tools = new GitHubPublicResearchTools({
    fetchImpl: asFetch(async () => {
      controller.abort("caller_cancelled");
      return Response.json(repositoryPayload);
    }),
  });
  await assert.rejects(
    () => tools.inspectProject("octocat/hello-world", controller.signal),
    expectToolError("ABORTED"),
  );
});

test("先发生的调用方取消不会被稍后的超时覆盖", async () => {
  const fetchImpl = asFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => {
      setTimeout(() => reject(signal.reason), 25);
    }, { once: true });
  }));
  const controller = new AbortController();
  const tools = new GitHubPublicResearchTools({ fetchImpl, timeoutMs: 10 });
  const pending = tools.inspectProject("octocat/hello-world", controller.signal);
  controller.abort("caller_cancelled");
  await assert.rejects(() => pending, expectToolError("ABORTED"));
});

test("Agent 不会把调用方取消吞成正常 BLOCKED", async () => {
  const fetchImpl = asFetch(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    assert.ok(signal);
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const tools = new GitHubPublicResearchTools({ fetchImpl, timeoutMs: 1_000 });
  const pending = runResearchAgent({
    objective: "验证取消传播",
    requiredProjects: ["octocat/hello-world"],
    requiredFields: ["language"],
    maxToolCalls: 3,
    maxReplans: 1,
  }, tools, undefined, { signal: controller.signal });
  controller.abort("caller_cancelled");
  await assert.rejects(() => pending, expectToolError("ABORTED"));
});

test("任意域名、伪装域名和带参数 URL 在网络调用前被拒绝", async () => {
  let calls = 0;
  const tools = new GitHubPublicResearchTools({
    fetchImpl: asFetch(async () => {
      calls += 1;
      return Response.json(repositoryPayload);
    }),
  });
  const unsafeTargets = [
    "https://evil.example/octocat/hello-world",
    "https://github.com@evil.example/octocat/hello-world",
    "https://github.com/octocat/hello-world?next=https://evil.example",
    "http://github.com/octocat/hello-world",
    "https://api.github.com/user",
  ];

  for (const target of unsafeTargets) {
    await assert.rejects(() => tools.inspectProject(target), expectToolError("INVALID_TARGET"));
  }
  assert.equal(calls, 0);
});

test("超过大小上限的响应在解析前被拒绝", async () => {
  const body = JSON.stringify(repositoryPayload);
  const tools = new GitHubPublicResearchTools({
    maxResponseBytes: 32,
    fetchImpl: asFetch(async () => new Response(body, {
      headers: { "content-length": String(Buffer.byteLength(body)) },
    })),
  });
  await assert.rejects(() => tools.inspectProject("octocat/hello-world"), expectToolError("RESPONSE_TOO_LARGE"));
});

test("无 Content-Length 的流式超限响应会停止读取", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(24));
      controller.enqueue(new Uint8Array(24));
    },
    cancel() {
      cancelled = true;
    },
  });
  const tools = new GitHubPublicResearchTools({
    maxResponseBytes: 32,
    fetchImpl: asFetch(async () => new Response(body)),
  });
  await assert.rejects(() => tools.inspectProject("octocat/hello-world"), expectToolError("RESPONSE_TOO_LARGE"));
  assert.equal(cancelled, true);
});

test("响应中的仓库身份不能改变受信任目标", async () => {
  const tools = new GitHubPublicResearchTools({
    fetchImpl: asFetch(async () => Response.json({ ...repositoryPayload, full_name: "attacker/other" })),
  });
  await assert.rejects(() => tools.inspectProject("octocat/hello-world"), expectToolError("INVALID_RESPONSE"));
});

test("异常字段类型统一分类为 INVALID_RESPONSE", async () => {
  const invalidPayloads = [
    { ...repositoryPayload, private: "false" },
    { ...repositoryPayload, license: [] },
    { ...repositoryPayload, license: { spdx_id: 7, name: "MIT" } },
    { ...repositoryPayload, archived: "false" },
    { ...repositoryPayload, topics: ["agent", 7] },
  ];
  for (const payload of invalidPayloads) {
    const tools = new GitHubPublicResearchTools({
      fetchImpl: asFetch(async () => Response.json(payload)),
    });
    await assert.rejects(() => tools.inspectProject("octocat/hello-world"), expectToolError("INVALID_RESPONSE"));
  }
});

test("超时与响应大小配置具有有限上界", () => {
  assert.throws(
    () => new GitHubPublicResearchTools({ timeoutMs: 60_001 }),
    /timeoutMs must be an integer between 1 and 60000/,
  );
  assert.throws(
    () => new GitHubPublicResearchTools({ maxResponseBytes: 2 * 1024 * 1024 + 1 }),
    /maxResponseBytes must be an integer between 1 and 2097152/,
  );
});
