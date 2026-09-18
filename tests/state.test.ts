import { expect, test } from "bun:test";
import { buildRouterState } from "../src/state.ts";

test("buildRouterState keeps objectives and tool outcomes but drops reasoning", () => {
  const state = buildRouterState([
    {
      role: "user",
      content: [{ type: "text", text: "Fix the failing tests and push the change." }],
    },
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "private chain of thought" },
        { type: "text", text: "I will inspect the failing suite." },
        {
          type: "tool-call",
          id: "call-1",
          name: "bash",
          input: { command: "bun test" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "call-1",
          name: "bash",
          result: { type: "text", value: "2 tests failed" },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: "call-2",
          name: "write",
          input: { path: "src/fix.ts" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: "call-2",
          name: "write",
          result: { type: "error", value: "permission denied" },
        },
      ],
    },
  ]);

  expect(state.user_request).toBe("Fix the failing tests and push the change.");
  expect(state.assistant_said).toEqual(["I will inspect the failing suite."]);
  expect(JSON.stringify(state)).not.toContain("private chain of thought");
  expect(state.actions_taken).toEqual([
    {
      step: 1,
      tool: "bash",
      input: '{"command":"bun test"}',
      result: "2 tests failed",
      status: "completed",
    },
    {
      step: 2,
      tool: "write",
      input: '{"path":"src/fix.ts"}',
      result: "permission denied",
      status: "error",
    },
  ]);
});

test("buildRouterState preserves a small amount of prior user context", () => {
  const state = buildRouterState([
    { role: "user", content: [{ type: "text", text: "First instruction" }] },
    { role: "assistant", content: [{ type: "text", text: "Okay" }] },
    { role: "user", content: [{ type: "text", text: "Current instruction" }] },
  ]);

  expect(state.user_request).toBe("Current instruction");
  expect(state.prior_user_messages).toEqual(["First instruction"]);
});
