import { expect, test } from "bun:test";
import {
  describeTool,
  groupToolsByFamily,
  keepOnlyTools,
  mergeModelOptions,
  toolFamily,
} from "../src/tools.ts";

test("toolFamily keeps MCP namespaces together and recognizes common prefixes", () => {
  expect(toolFamily("mcp__GitHub__create_issue")).toBe("mcp__GitHub");
  expect(toolFamily("calendar_create_event")).toBe("calendar");
  expect(toolFamily("github.search")).toBe("github");
  expect(toolFamily("read")).toBe("read");
});

test("describeTool gives Jev a compact schema-oriented description", () => {
  const description = describeTool(
    "read",
    {
      description: "Read a file from disk.",
      input: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string" },
          offset: { type: "number" },
        },
      },
    },
    900,
  );

  expect(description).toContain("Read a file from disk.");
  expect(description).toContain("path:string!");
  expect(description).toContain("offset:number");
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
