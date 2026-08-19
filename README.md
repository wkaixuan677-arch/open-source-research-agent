# Open Source Research Agent

[![CI](https://github.com/wkaixuan677-arch/open-source-research-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/wkaixuan677-arch/open-source-research-agent/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/wkaixuan677-arch/open-source-research-agent)](https://github.com/wkaixuan677-arch/open-source-research-agent/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一个面向开源项目调研的轻量 Agent：先制定证据采集计划，再调用工具读取项目资料，对引用和任务覆盖度进行审查，必要时重规划，最后生成带证据编号的报告。

> 本仓库是独立 clean-room 作品，不包含任何公司代码、内部数据、私有提示词或生产凭据。

![Open Source Research Agent 演示](docs/demo.gif)

查看：[完整架构说明](docs/ARCHITECTURE.md) · [中文面试讲解材料](docs/INTERVIEW_GUIDE.md)

作品集导航：[Browser Runtime](https://github.com/wkaixuan677-arch/browser-agent-runtime-lite) · [Agent Eval Lab](https://github.com/wkaixuan677-arch/agent-eval-lab) · **Research Agent**

## 为什么做这个项目

普通搜索脚本只负责“找到内容”，但 Agent 还需要回答三个问题：目标是否真的完成、结论是否有证据、工具失败后是否能安全恢复。本项目用可测试的状态和接口演示这些能力。

## Agent 工作流

```text
ResearchTask
    ↓
PLAN → ACT(tool) → VERIFY(reviewer)
          ↑              ↓
          └── REPLAN ────┘
                         ↓
                      FINALIZE
```

- **Task Contract**：定义项目、必需字段、工具和重规划预算；
- **Tool Calling**：搜索候选项目并读取结构化资料；
- **Evidence Grounding**：每条结论绑定证据 ID 与来源；
- **Reviewer**：检查缺失字段和引用 ID 完整性，拒绝“看似完成”；
- **Bounded Replanning**：瞬时失败后有限重试，预算耗尽则输出 `PARTIAL/BLOCKED`；
- **Trajectory**：记录 PLAN、ACT、VERIFY、REPLAN、FINALIZE 事件。

## 快速运行

需要 Node.js 22 及以上版本。

```bash
npm ci
npm run check
```

演示完全离线，不需要 API Key，也不会访问真实账号。结果写入 `reports/demo-result.json`，该文件默认不提交。

预期输出示例：

```text
状态：COMPLETED
证据：8 条；工具调用：4；重规划：1
阶段：PLAN → ACT → PLAN → REPLAN → ACT → ACT → VERIFY → FINALIZE
```

## 设计边界

- 当前使用本地 fixture，目的是保证演示与测试可重复；
- 当前没有接入真实 LLM；公开版实现了可插拔 `ResearchPlanner`、显式计划版本和策略变化，默认使用确定性 Planner 保证复现；
- 不处理登录、验证码、私有仓库或凭据；
- 演示结果不是线上性能或实际业务收益。

## 后续计划

- 增加只读 GitHub API 适配器和缓存；
- 增加可插拔 Model Adapter，让 Planner 可由结构化模型输出驱动；
- 增加来源时效、冲突证据和可信度评估；
- 使用公开、可复现任务集评估报告正确率和引用覆盖率。

## 安全与贡献

请阅读 [SECURITY.md](SECURITY.md) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。本项目采用 [MIT License](LICENSE)。
