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

test("buildRouterState preserves only the immediately relevant user context", () => {
  const state = buildRouterState([
    { role: "user", content: [{ type: "text", text: "Old instruction" }] },
    { role: "user", content: [{ type: "text", text: "Previous instruction" }] },
    { role: "user", content: [{ type: "text", text: "Current instruction" }] },
  ]);

  expect(state.user_request).toBe("Current instruction");
  expect(state.prior_user_messages).toEqual(["Previous instruction"]);
});

test("buildRouterState bounds recent progress, action inputs and action results", () => {
  const messages: unknown[] = [
    { role: "user", content: [{ type: "text", text: "Optimize the router." }] },
  ];

  for (let index = 1; index <= 10; index++) {
    messages.push({
      role: "assistant",
      content: [
        { type: "text", text: `assistant progress ${index}` },
        {
          type: "tool-call",
          id: `call-${index}`,
          name: "shell",
          input: { command: "x".repeat(600), index },
        },
      ],
    });
    messages.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          id: `call-${index}`,
          name: "shell",
          result: { type: "text", value: "y".repeat(1_000) },
        },
      ],
    });
  }

  const state = buildRouterState(messages);

  expect(state.actions_taken).toHaveLength(8);
  expect(state.actions_taken[0]?.step).toBe(3);
  expect(state.actions_taken.at(-1)?.step).toBe(10);
  expect(state.assistant_said).toEqual(["assistant progress 9", "assistant progress 10"]);

  for (const action of state.actions_taken) {
    expect(action.input.length).toBeLessThanOrEqual(400);
    expect(action.result.length).toBeLessThanOrEqual(800);
    expect(action.input).toEndWith("…[truncated]");
    expect(action.result).toEndWith("…[truncated]");
  }

  expect(JSON.stringify(state).length).toBeLessThan(12_000);
});
