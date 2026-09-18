import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
  test("uses conservative shortlist defaults", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  test("accepts provider model options and explicit routing thresholds", () => {
    const config = parseConfig({
      mode: "strict",
      hardThreshold: 0.9,
      softThreshold: 0.6,
      doneThreshold: 0.8,
      topK: 4,
      modelOptions: {
        openai: { reasoningEffort: "low" },
      },
    });

    expect(config.mode).toBe("strict");
    expect(config.topK).toBe(4);
    expect(config.modelOptions.openai).toEqual({ reasoningEffort: "low" });
  });

  test("rejects an inverted confidence band", () => {
    expect(() =>
      parseConfig({
        softThreshold: 0.9,
        hardThreshold: 0.8,
      }),
    ).toThrow();
  });

  test("rejects unknown options instead of silently ignoring typos", () => {
    expect(() => parseConfig({ hardTreshold: 0.8 })).toThrow();
  });
});
