import type { ProjectRecord } from "./types.js";

export const FIXTURE_PROJECTS: ProjectRecord[] = [
  {
    name: "Trailblazer",
    language: "TypeScript",
    license: "MIT",
    features: ["有界工具调用", "结构化轨迹", "本地确定性演示"],
    limitations: ["不包含远程模型适配器"],
    sourceUrl: "fixture://trailblazer/README.md"
  },
  {
    name: "EvidenceKit",
    language: "Python",
    license: "Apache-2.0",
    features: ["证据引用", "报告审查", "失败归因"],
    limitations: ["不执行浏览器交互"],
    sourceUrl: "fixture://evidence-kit/README.md"
  }
];
