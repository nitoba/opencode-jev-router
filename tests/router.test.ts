import { expect, test } from "bun:test";
import { parseConfig } from "../src/config.ts";
import { createJevRouter, RouterCapacityError } from "../src/router.ts";
import type { ToolCatalog } from "../src/types.ts";
import { booleanEvidence, choiceEvidence, fixture } from "./helpers.ts";

const state = {
  user_request: "Find the failure and fix it.",
  prior_user_messages: [],
  actions_taken: [],
  assistant_said: [],
} as const;

test("direct routing asks nextTool and done in one Questions evaluation", async () => {
  const { model, calls } = fixture((question, key) => {
    if (key === "done") return booleanEvidence(0.1);
    if (question.type !== "choice") throw new Error("Expected a choice");
    return choiceEvidence(question, "read", 0.91);
  });
  const router = createJevRouter(model, parseConfig({}));
  const tools: ToolCatalog = {
    read: { description: "Read a file", input: { type: "object" } },
    grep: { description: "Search source code", input: { type: "object" } },
  };

  const result = await router.evaluate(state, tools);

  expect(calls).toHaveLength(1);
  expect(Object.keys(calls[0]!.questions).sort()).toEqual(["done", "nextTool"]);
  expect(result.nextTool.choice).toBe("read");
  expect(result.done.probability).toBe(0.1);
  expect(result.calls).toBe(1);
});

test("oversized catalogs route through a semantic family and then one tool", async () => {
  const { model, calls } = fixture((question, key) => {
    if (key === "done") return booleanEvidence(0.1);
    if (question.type !== "choice") throw new Error("Expected a choice");
    if (key === "nextFamily") return choiceEvidence(question, "beta", 0.92);
    return choiceEvidence(question, "beta_128", 0.88);
  });
  const router = createJevRouter(model, parseConfig({}));
  const tools: Record<string, { description: string; input: unknown }> = {};

  for (let index = 0; index < 128; index++) {
    tools[`alpha_${index}`] = { description: `Alpha tool ${index}`, input: {} };
  }
  for (let index = 128; index < 256; index++) {
    tools[`beta_${index}`] = { description: `Beta tool ${index}`, input: {} };
  }

  const result = await router.evaluate(state, tools);

  expect(calls).toHaveLength(2);
  expect(result.calls).toBe(2);
  expect(result.selectedFamily).toBe("beta");
  expect(result.nextTool.choice).toBe("beta_128");
  expect(result.nextTool.confidence).toBe(0.88);
});

test("oversized catalogs fail open when they cannot be split into safe families", async () => {
  const { model, calls } = fixture(() => {
    throw new Error("The provider should not be called");
  });
  const router = createJevRouter(model, parseConfig({}));
  const tools: Record<string, { description: string; input: unknown }> = {};

  for (let index = 0; index < 256; index++) {
    tools[`same_${index}`] = { description: `Same family ${index}`, input: {} };
  }

  await expect(router.evaluate(state, tools)).rejects.toBeInstanceOf(RouterCapacityError);
  expect(calls).toHaveLength(0);
});
