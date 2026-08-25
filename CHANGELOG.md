# Changelog

## [0.3.0] - 2026-08-19

- 增加可选 `GitHubPublicResearchTools`，以无 Token、只读方式获取公共仓库元数据；
- 仅接受受信任 GitHub 仓库目标，并固定构造 `GET api.github.com/repos/{owner}/{repo}`，拒绝任意 URL、重定向和写操作；
- 增加固定 User-Agent、超时、调用方 AbortSignal、响应大小上限、响应身份校验和细分错误类型；
- 在每个异步阶段后重新确认取消状态，并把可选 AbortSignal 传入 Planner context；
- 明确当前 `searchProjects` 阶段校验显式目标而不是开放式关键词搜索；
- 对显式项目身份做大小写与 GitHub URL 规范化去重，并拒绝重复 Evidence ID；
- 演示支持 `fixture`（默认）与 `github` 两种模式，默认离线行为保持不变；
- 使用 mock fetch 覆盖成功、404、限流、超时、取消、跨域输入、响应过大和身份不匹配，不在测试中访问真实网络；
- 将 npm 包标记为私有，明确本仓库是可运行的研究原型，而不是承诺稳定 API 的 SDK；
- 将 CI 使用的 GitHub Actions 固定到已核验的提交，降低上游标签漂移风险；
- 明确该适配器仅用于公共元数据和 Agent 工具边界演示，不是生产 GitHub 客户端。

## [0.2.0] - 2026-08-19

- 增加可插拔 `ResearchPlanner`、显式计划版本和步骤状态；
- 让搜索发现结果真正决定执行计划，瞬时失败后会改变重试策略；
- 区分可重试与永久工具错误，补充非法预算和未发现项目测试；
- 将公开口径收敛为“引用完整性”，不把 ID 校验夸大为来源真实性。

## [0.1.0] - 2026-08-19

- 发布 Research Task Contract、结构化只读工具与 Evidence Store；
- 增加引用审查、覆盖检查和工具失败后的有界重规划；
- 提供确定性离线演示、自动测试、架构图、演示 GIF 与面试材料。

[0.1.0]: https://github.com/coolwkx/open-source-research-agent/releases/tag/v0.1.0
[0.2.0]: https://github.com/coolwkx/open-source-research-agent/compare/v0.1.0...v0.2.0
[0.3.0]: https://github.com/coolwkx/open-source-research-agent/compare/v0.2.0...v0.3.0
