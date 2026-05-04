import { describe, expect, it } from "vitest";

import { loadDeclarativeFlow } from "../src/pipeline/declarative-flows.js";

describe("GitLab flow artifact publication", () => {
  it("publishes GitLab diff review markdown and JSON artifacts from the LLM step", async () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "gitlab/gitlab-diff-review.json" });
    const reviewPhase = flow.phases.find((phase) => phase.id === "gitlab_diff_review");
    const runStep = reviewPhase?.steps.find((step) => step.id === "run_diff_review");

    expect(runStep).toBeDefined();
    expect(runStep?.params?.requiredArtifacts).toEqual({
      list: [
        {
          artifact: {
            kind: "review-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.iteration" },
          },
        },
        {
          artifact: {
            kind: "review-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.iteration" },
          },
        },
      ],
    });
  });

  it("publishes GitLab review assessment markdown and JSON artifacts from the LLM step", async () => {
    const flow = await loadDeclarativeFlow({ source: "built-in", fileName: "gitlab/gitlab-review.json" });
    const reviewPhase = flow.phases.find((phase) => phase.id === "gitlab_review");
    const runStep = reviewPhase?.steps.find((step) => step.id === "assess_gitlab_review");

    expect(runStep).toBeDefined();
    expect(runStep?.params?.requiredArtifacts).toEqual({
      list: [
        {
          artifact: {
            kind: "review-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.iteration" },
          },
        },
        {
          artifact: {
            kind: "review-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.iteration" },
          },
        },
        {
          artifact: {
            kind: "review-assessment-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.iteration" },
          },
        },
        {
          artifact: {
            kind: "review-assessment-json-file",
            taskKey: { ref: "params.taskKey" },
            iteration: { ref: "params.iteration" },
          },
        },
      ],
    });
  });
});
