import type { ProjectRecord } from "./types.js";

export class LocalResearchTools {
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
      throw new Error("transient_tool_failure");
    }
    const project = this.projects.find((item) => item.name === name);
    if (!project) throw new Error(`project_not_found:${name}`);
    return structuredClone(project);
  }
}
