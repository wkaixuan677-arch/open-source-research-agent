import { ResearchToolError } from "./tools.js";
import type { ProjectRecord, ResearchToolset } from "./types.js";

export const GITHUB_READ_ONLY_USER_AGENT =
  "open-source-research-agent/0.3.0 (read-only; +https://github.com/coolwkx/open-source-research-agent)";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const GITHUB_API_VERSION = "2022-11-28";

export interface GitHubResearchToolsOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

interface RepositoryTarget {
  requestedName: string;
  owner: string;
  repo: string;
}

interface GitHubRepositoryResponse {
  full_name: string;
  private?: boolean;
  description: string | null;
  language: string | null;
  license: { spdx_id?: string | null; name?: string | null } | null;
  topics?: unknown;
  archived?: boolean;
  disabled?: boolean;
  fork?: boolean;
}

/**
 * A deliberately narrow adapter for unauthenticated, public GitHub repository metadata.
 * It exposes no generic request method and always performs GET requests against a URL it constructs.
 */
export class GitHubPublicResearchTools implements ResearchToolset {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;

  constructor(options: GitHubResearchToolsOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = requireBoundedPositiveInteger(
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      "timeoutMs",
      MAX_TIMEOUT_MS,
    );
    this.maxResponseBytes = requireBoundedPositiveInteger(
      options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
      MAX_RESPONSE_BYTES,
    );
  }

  searchProjects(names: string[]): string[] {
    return names.map((name) => parseRepositoryTarget(name).requestedName);
  }

  async inspectProject(name: string, signal?: AbortSignal): Promise<ProjectRecord> {
    const target = parseRepositoryTarget(name);
    const apiUrl = buildRepositoryApiUrl(target);
    const payload = await this.getRepository(apiUrl, signal);
    validateRepositoryResponse(payload, target);

    const features = repositoryFeatures(payload);
    const limitations = ["仅基于 GitHub 公共仓库元数据，不分析源码语义"];
    if (payload.archived) limitations.push("仓库已归档");
    if (payload.disabled) limitations.push("仓库已禁用");
    if (payload.fork) limitations.push("该仓库是 Fork");

    return {
      name: target.requestedName,
      language: payload.language?.trim() || "未标注",
      license: payload.license?.spdx_id?.trim() || payload.license?.name?.trim() || "未检测到明确许可证",
      features,
      limitations,
      sourceUrl: apiUrl.toString(),
    };
  }

  private async getRepository(apiUrl: URL, externalSignal?: AbortSignal): Promise<GitHubRepositoryResponse> {
    if (externalSignal?.aborted) {
      throw new ResearchToolError("ABORTED", false, "github_request_aborted");
    }
    const controller = new AbortController();
    let abortSource: "caller" | "timeout" | undefined;
    const abortFromCaller = () => {
      if (abortSource) return;
      abortSource = "caller";
      controller.abort(externalSignal?.reason);
    };
    externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timeout = setTimeout(() => {
      if (abortSource) return;
      abortSource = "timeout";
      controller.abort(new DOMException("github_request_timeout", "TimeoutError"));
    }, this.timeoutMs);

    try {
      const response = await this.fetchImpl(apiUrl, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": GITHUB_READ_ONLY_USER_AGENT,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
      });
      throwForAbortSource(abortSource, this.timeoutMs);

      if (response.status === 404) {
        await cancelResponseBody(response);
        throw new ResearchToolError("PROJECT_NOT_FOUND", false, "github_project_not_found");
      }
      if (isRateLimited(response)) {
        await cancelResponseBody(response);
        throw new ResearchToolError(
          "RATE_LIMITED",
          true,
          "github_rate_limited",
          parseRetryAfterMs(response.headers),
        );
      }
      if (response.status >= 500) {
        await cancelResponseBody(response);
        throw new ResearchToolError("TRANSIENT_FAILURE", true, `github_server_failure:${response.status}`);
      }
      if (!response.ok) {
        await cancelResponseBody(response);
        throw new ResearchToolError("HTTP_FAILURE", false, `github_http_failure:${response.status}`);
      }

      const payload = await readLimitedJson(response, this.maxResponseBytes);
      throwForAbortSource(abortSource, this.timeoutMs);
      return payload;
    } catch (error) {
      if (error instanceof ResearchToolError) throw error;
      if (abortSource === "caller") {
        throw new ResearchToolError("ABORTED", false, "github_request_aborted");
      }
      if (abortSource === "timeout") {
        throw new ResearchToolError("TIMEOUT", true, `github_request_timeout:${this.timeoutMs}ms`);
      }
      if (externalSignal?.aborted) {
        throw new ResearchToolError("ABORTED", false, "github_request_aborted");
      }
      throw new ResearchToolError(
        "TRANSIENT_FAILURE",
        true,
        `github_transport_failure:${error instanceof Error ? error.message : "unknown"}`,
      );
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

function requireBoundedPositiveInteger(value: number, name: string, maximum: number): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`${name} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function throwForAbortSource(source: "caller" | "timeout" | undefined, timeoutMs: number): void {
  if (source === "caller") {
    throw new ResearchToolError("ABORTED", false, "github_request_aborted");
  }
  if (source === "timeout") {
    throw new ResearchToolError("TIMEOUT", true, `github_request_timeout:${timeoutMs}ms`);
  }
}

function parseRepositoryTarget(rawTarget: string): RepositoryTarget {
  const requestedName = rawTarget.trim();
  if (!requestedName) throw invalidTarget("empty_repository_target");

  let owner: string;
  let repo: string;
  if (!requestedName.includes("://")) {
    const segments = requestedName.split("/");
    if (segments.length !== 2) throw invalidTarget("expected_owner_and_repo");
    [owner, repo] = segments;
  } else {
    let url: URL;
    try {
      url = new URL(requestedName);
    } catch {
      throw invalidTarget("invalid_repository_url");
    }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) {
      throw invalidTarget("repository_url_must_be_plain_https");
    }
    const segments = url.pathname.split("/").filter(Boolean).map(decodePathSegment);
    if (url.hostname === "github.com" && segments.length === 2) {
      [owner, repo] = segments;
    } else if (url.hostname === "api.github.com" && segments.length === 3 && segments[0] === "repos") {
      [, owner, repo] = segments;
    } else {
      throw invalidTarget("untrusted_or_non_repository_url");
    }
  }

  if (!isValidOwner(owner) || !isValidRepo(repo)) throw invalidTarget("invalid_owner_or_repo");
  return { requestedName, owner, repo };
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidTarget("invalid_path_encoding");
  }
}

function isValidOwner(value: string): boolean {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(value) && !value.endsWith("-");
}

function isValidRepo(value: string): boolean {
  return value.length <= 100 && /^[A-Za-z0-9_.-]+$/.test(value) && value !== "." && value !== "..";
}

function invalidTarget(reason: string): ResearchToolError {
  return new ResearchToolError("INVALID_TARGET", false, `invalid_github_target:${reason}`);
}

function buildRepositoryApiUrl(target: RepositoryTarget): URL {
  const url = new URL("https://api.github.com/");
  url.pathname = `repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`;
  return url;
}

function isRateLimited(response: Response): boolean {
  // For this unauthenticated, fixed public metadata endpoint, GitHub uses 403 for
  // both primary and secondary rate limits; secondary limits do not always return
  // x-ratelimit-remaining=0 or retry-after.
  return response.status === 429 || response.status === 403;
}

function parseRetryAfterMs(headers: Headers): number | undefined {
  const retryAfter = headers.get("retry-after");
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1_000;
  const reset = headers.get("x-ratelimit-reset");
  if (reset && /^\d+$/.test(reset)) return Math.max(0, Number(reset) * 1_000 - Date.now());
  return undefined;
}

async function readLimitedJson(response: Response, maxBytes: number): Promise<GitHubRepositoryResponse> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > maxBytes) {
    await cancelResponseBody(response);
    throw new ResearchToolError("RESPONSE_TOO_LARGE", false, `github_response_too_large:${contentLength}`);
  }

  if (!response.body) throw new ResearchToolError("INVALID_RESPONSE", false, "github_response_body_missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel("response_size_limit_exceeded");
      throw new ResearchToolError("RESPONSE_TOO_LARGE", false, `github_response_too_large:>${maxBytes}`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body)) as GitHubRepositoryResponse;
  } catch {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_response_invalid_json");
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel("response_not_consumed");
  } catch {
    // Cleanup failure must not replace the typed request error.
  }
}

function validateRepositoryResponse(payload: GitHubRepositoryResponse, target: RepositoryTarget): void {
  if (!payload || typeof payload !== "object" || typeof payload.full_name !== "string") {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_repository_shape_invalid");
  }
  if (typeof payload.private !== "boolean" || payload.private) {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_private_repository_rejected");
  }
  const expected = `${target.owner}/${target.repo}`.toLowerCase();
  if (payload.full_name.toLowerCase() !== expected) {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_repository_identity_mismatch");
  }
  if (payload.description !== null && typeof payload.description !== "string") {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_repository_description_invalid");
  }
  if (payload.language !== null && typeof payload.language !== "string") {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_repository_language_invalid");
  }
  if (payload.license !== null && (
    typeof payload.license !== "object"
    || Array.isArray(payload.license)
    || (payload.license.spdx_id !== null && payload.license.spdx_id !== undefined && typeof payload.license.spdx_id !== "string")
    || (payload.license.name !== null && payload.license.name !== undefined && typeof payload.license.name !== "string")
  )) {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_repository_license_invalid");
  }
  for (const [field, value] of [
    ["archived", payload.archived],
    ["disabled", payload.disabled],
    ["fork", payload.fork],
  ] as const) {
    if (value !== undefined && typeof value !== "boolean") {
      throw new ResearchToolError("INVALID_RESPONSE", false, `github_repository_${field}_invalid`);
    }
  }
  if (payload.topics !== undefined && (
    !Array.isArray(payload.topics)
    || payload.topics.some((topic) => typeof topic !== "string")
  )) {
    throw new ResearchToolError("INVALID_RESPONSE", false, "github_repository_topics_invalid");
  }
}

function repositoryFeatures(payload: GitHubRepositoryResponse): string[] {
  const features: string[] = [];
  if (payload.description?.trim()) features.push(`项目描述：${payload.description.trim()}`);
  const topics = Array.isArray(payload.topics)
    ? payload.topics.filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
    : [];
  if (topics.length > 0) features.push(`主题：${topics.join("、")}`);
  return features.length > 0 ? features : ["GitHub 公共仓库元数据可读取"];
}
