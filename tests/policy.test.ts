import { expect, test } from "bun:test";
import { parseConfig } from "../src/config.ts";
import { createRoutingPlan } from "../src/policy.ts";
import { RESPOND_TO_USER, type RoutingEvaluation } from "../src/types.ts";

function evaluation(
  choice: string,
  confidence: number,
  done: number,
  probabilities: Record<string, number>,
): RoutingEvaluation {
  return {
    nextTool: {
      type: "choice",
      choice,
      probabilities,
      confidence,
    },
    done: {
      type: "boolean",
      probability: done,
    },
    ranked: Object.entries(probabilities)
      .sort((left, right) => right[1] - left[1])
      .map(([name, probability]) => ({ name, probability })),
    model: "fixture",
    usage: { inputTokens: 10, outputTokens: 1 },
    latencyMs: 20,
    calls: 1,
    catalogSize: 3,
  };
}

test("high confidence exposes only Jev's selected tool", () => {
  const config = parseConfig({});
  const plan = createRoutingPlan(
    evaluation("read", 0.9, 0.1, { read: 0.9, grep: 0.08, [RESPOND_TO_USER]: 0.02 }),
    ["read", "grep"],
    config,
  );

  expect(plan).toMatchObject({
    kind: "tools",
    tools: ["read"],
    reason: "high-confidence",
  });
});

test("medium confidence exposes the top-k tools", () => {
  const config = parseConfig({ softThreshold: 0.5, hardThreshold: 0.8, topK: 2 });
  const plan = createRoutingPlan(
    evaluation("read", 0.65, 0.1, {
      read: 0.55,
      grep: 0.35,
      write: 0.08,
      [RESPOND_TO_USER]: 0.02,
    }),
    ["read", "grep", "write"],
    config,
  );

  expect(plan).toMatchObject({
    kind: "tools",
    tools: ["read", "grep"],
    reason: "shortlist",
  });
});

test("low confidence fails open in shortlist mode", () => {
  const config = parseConfig({ softThreshold: 0.6 });
  const plan = createRoutingPlan(
    evaluation("read", 0.4, 0.1, { read: 0.5, grep: 0.5 }),
    ["read", "grep"],
    config,
  );

  expect(plan.kind).toBe("fallback");
  expect(plan.reason).toBe("low-confidence");
});

test("strict mode keeps one tool even below the confidence threshold", () => {
  const config = parseConfig({ mode: "strict" });
  const plan = createRoutingPlan(
    evaluation("grep", 0.2, 0.1, { grep: 0.6, read: 0.4 }),
    ["grep", "read"],
    config,
  );

  expect(plan).toMatchObject({
    kind: "tools",
    tools: ["grep"],
    reason: "strict",
  });
});

test("respond requires independent done evidence", () => {
  const config = parseConfig({ doneThreshold: 0.7 });

  const completed = createRoutingPlan(
    evaluation(RESPOND_TO_USER, 0.9, 0.9, {
      [RESPOND_TO_USER]: 0.8,
      read: 0.2,
    }),
    ["read"],
    config,
  );
  expect(completed.kind).toBe("respond");

  const premature = createRoutingPlan(
    evaluation(RESPOND_TO_USER, 0.9, 0.2, {
      [RESPOND_TO_USER]: 0.6,
      read: 0.4,
    }),
    ["read"],
    config,
  );
  expect(premature).toMatchObject({
    kind: "tools",
    selected: "read",
    tools: ["read"],
  });
});
