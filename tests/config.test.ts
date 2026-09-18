import { describe, expect, test } from "bun:test";
import { DEFAULT_CONFIG, parseConfig } from "../src/config.ts";

describe("parseConfig", () => {
  test("uses conservative TypeSafe shortlist defaults", () => {
    expect(parseConfig({})).toEqual(DEFAULT_CONFIG);
  });

  test("uses Vercel evaluation defaults when provider is vercel", () => {
    const config = parseConfig({ provider: "vercel" });
    expect(config.provider).toBe("vercel");
    expect(config.apiKeyEnv).toBe("AI_GATEWAY_API_KEY");
    expect(config.model).toBe("typesafe-ai/jev");
    expect(config.baseURL).toBeUndefined();
  });

  test("accepts the Vercel Evaluation V4 base URL", () => {
    expect(
      parseConfig({
        provider: "vercel",
        baseURL: "https://ai-gateway.vercel.sh/v4/ai",
      }).baseURL,
    ).toBe("https://ai-gateway.vercel.sh/v4/ai");
  });

  test("rejects the OpenAI-compatible Vercel /v1 route", () => {
    expect(() =>
      parseConfig({
        provider: "vercel",
        baseURL: "https://ai-gateway.vercel.sh/v1",
      }),
    ).toThrow("Evaluation V4 endpoint");
  });

  test("rejects a Vercel Gateway URL with the TypeSafe provider", () => {
    expect(() =>
      parseConfig({
        provider: "typesafe",
        baseURL: "https://ai-gateway.vercel.sh/v4/ai",
      }),
    ).toThrow('provider: "vercel"');
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
    expect(() => parseConfig({ softThreshold: 0.9, hardThreshold: 0.8 })).toThrow();
  });

  test("rejects unknown options instead of silently ignoring typos", () => {
    expect(() => parseConfig({ hardTreshold: 0.8 })).toThrow();
  });
});
