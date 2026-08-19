import type { ResearchPlan, ResearchPlanner, ResearchTask } from "./types.js";

export class DeterministicPlanner implements ResearchPlanner {
  createPlan(task: ResearchTask, discoveredProjects: string[]): ResearchPlan {
    const discovered = new Set(discoveredProjects);
    return {
      revision: 1,
      rationale: "仅为搜索实际发现的项目创建只读证据采集步骤",
      steps: task.requiredProjects.filter((project) => discovered.has(project)).map((project) => ({
        project,
        status: "PENDING",
        strategy: "inspect",
        attempt: 0,
      })),
    };
  }

  revisePlan(plan: ResearchPlan, project: string, reason: string): ResearchPlan {
    return {
      revision: plan.revision + 1,
      rationale: `因 ${reason} 调整 ${project} 的策略`,
      steps: plan.steps.map((step) => step.project === project ? {
        ...step,
        status: "PENDING",
        strategy: "retry_after_transient_failure",
        attempt: step.attempt + 1,
      } : { ...step }),
    };
  }
}
