import type { ProjectRecord, ResearchToolset } from "./types.js";

export class ResearchToolError extends Error {
  constructor(
    readonly code: "TRANSIENT_FAILURE" | "PROJECT_NOT_FOUND",
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
  }
}

export class LocalResearchTools implements ResearchToolset {
  private failuresLeft: number;

  constructor(private readonly projects: ProjectRecord[], transientFailures = 0) {
    this.failuresLeft = transientFailures;
  }

  searchProjects(names: string[]): string[] {
    return this.projects.filter((project) => names.includes(project.name)).map((project) => project.name);
  }

  inspectProject(name: string): ProjectRecord {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new ResearchToolError("TRANSIENT_FAILURE", true, "transient_tool_failure");
    }
    const project = this.projects.find((item) => item.name === name);
    if (!project) throw new ResearchToolError("PROJECT_NOT_FOUND", false, `project_not_found:${name}`);
    return structuredClone(project);
  }
}
