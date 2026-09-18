import { expect, test } from "bun:test";
import {
  describeFamily,
  describeTool,
  groupToolsByFamily,
  keepOnlyTools,
  mergeModelOptions,
  toolCriteriaChars,
  toolFamily,
} from "../src/tools.ts";

test("toolFamily keeps MCP namespaces together and recognizes common prefixes", () => {
  expect(toolFamily("mcp__GitHub__create_issue")).toBe("mcp__GitHub");
  expect(toolFamily("calendar_create_event")).toBe("calendar");
  expect(toolFamily("github.search")).toBe("github");
  expect(toolFamily("read")).toBe("read");
});

test("describeTool gives Jev a compact schema-oriented description without duplicating the key", () => {
  const description = describeTool(
    "read",
    {
      description: "Read a file\n\nfrom disk.",
      input: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
          offset: { type: "number" },
        },
      },
    },
    600,
  );

  expect(description).toContain("Read a file from disk.");
  expect(description).toContain("path:string!");
  expect(description).toContain("offset:number");
  expect(description).not.toContain("Tool name:");
  expect(description.length).toBeLessThanOrEqual(600);
});

test("tool criteria telemetry measures bounded descriptions sent to Jev", () => {
  const tools = {
    read: { description: "x".repeat(2_000), input: { type: "object" } },
    grep: { description: "Search code", input: { type: "object" } },
  };

  const chars = toolCriteriaChars(tools, 600);
  expect(chars).toBeLessThan(750);
  expect(chars).toBeGreaterThan(600);
});

test("family descriptions share the budget across multiple tools", () => {
  const description = describeFamily(
    "github",
    Object.fromEntries(
      Array.from({ length: 8 }, (_, index) => [
        `github_tool_${index}`,
        { description: "x".repeat(500), input: {} },
      ]),
    ),
    600,
  );

  expect(description.length).toBeLessThanOrEqual(600);
  expect(description).toContain("github_tool_0");
  expect(description).toContain("github_tool_1");
});

test("groupToolsByFamily and keepOnlyTools operate on the real dynamic catalog", () => {
  const tools = {
    github_search: { description: "search", input: {} },
    github_issue: { description: "issue", input: {} },
    read: { description: "read", input: {} },
  };
  const groups = groupToolsByFamily(tools);
  expect(Object.keys(groups.get("github") ?? {})).toHaveLength(2);

  keepOnlyTools(tools, ["read"]);
  expect(Object.keys(tools)).toEqual(["read"]);
});

test("mergeModelOptions preserves earlier nested provider options", () => {
  const options: Record<string, unknown> = {
    openai: { verbosity: "medium" },
  };
  mergeModelOptions(options, {
    openai: { reasoningEffort: "low" },
  });
  expect(options).toEqual({
    openai: {
      verbosity: "medium",
      reasoningEffort: "low",
    },
  });
});
