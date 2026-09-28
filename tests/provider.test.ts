import { afterEach, expect, spyOn, test } from "bun:test";
import { ProviderError } from "@nitoba/questions";
import { parseConfig } from "../src/config.ts";
import { createDecisionModel } from "../src/provider.ts";
import { createJevRouter } from "../src/router.ts";
import { RESPOND_TO_USER } from "../src/types.ts";

const state = {
  user_request: "Read the source file.",
  prior_user_messages: [],
  actions_taken: [],
  assistant_said: [],
};
const tools = {
  read: { description: "Read a file", input: {} },
  grep: { description: "Search files", input: {} },
};
const response = {
  id: "test-decision",
  provider: "TypeSafe",
  model: "typesafe/jev-1.13-20260917",
  answers: {
    nextTool: {
      type: "choice",
      choice: "read",
      confidence: 0.9,
      probabilities: { read: 0.9, grep: 0.08, [RESPOND_TO_USER]: 0.02 },
    },
    done: { type: "noul", noul: 0.1 },
  },
  usage: { input_tokens: 100, output_tokens: 20, cost: 0.00003 },
};

let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, "fetch">> | undefined;
afterEach(() => fetchSpy?.mockRestore());

test.each([
  {
    options: { provider: "openrouter" as const },
    endpoint: "https://openrouter.ai/api/v1/systemone",
    model: "typesafe/jev-1.13",
  },
  {
    options: {
      provider: "openrouter" as const,
      baseURL: "https://proxy.example/api/v1/",
      model: "~typesafe/jev-latest",
    },
    endpoint: "https://proxy.example/api/v1/systemone",
    model: "~typesafe/jev-latest",
  },
])("OpenRouter sends one System One batch to $endpoint", async ({ options, endpoint, model }) => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(Response.json(response));
  const config = parseConfig(options);
  const router = createJevRouter(createDecisionModel(config, "test-key"), config);

  const result = await router.evaluate(state, tools);

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, init] = fetchSpy.mock.calls[0]!;
  expect(String(url)).toBe(endpoint);
  expect(init?.method).toBe("POST");
  expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
  const body = JSON.parse(String(init?.body));
  expect(body.model).toBe(model);
  expect(body.state).toEqual(state);
  expect(Object.keys(body.questions).sort()).toEqual(["done", "nextTool"]);
  expect(body.questions.nextTool.type).toBe("choice");
  expect(body.questions.done.type).toBe("noul");
  expect(result.nextTool.choice).toBe("read");
  expect(result.nextTool.confidence).toBe(0.9);
  expect(result.nextTool.probabilitySource).toBe("provider");
  expect(result.done.probability).toBe(0.1);
  expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 20 });
  expect(result.model).toBe(response.model);
  expect(result.calls).toBe(1);
});

test("OpenRouter preserves sanitized 429 errors for the rate-limit circuit breaker", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ error: { message: "sensitive provider details" } }, { status: 429 }),
  );
  const config = parseConfig({ provider: "openrouter" });
  const router = createJevRouter(createDecisionModel(config, "test-key"), config);
  const error = await router.evaluate(state, tools).catch((cause: unknown) => cause);

  expect(error).toBeInstanceOf(ProviderError);
  expect(error).toMatchObject({ status: 429, provider: "OpenRouter" });
  expect(String(error)).not.toContain("sensitive provider details");
  expect(String(error)).not.toContain("test-key");
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("OpenRouter rejects incomplete evidence instead of producing a routing decision", async () => {
  fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({ ...response, answers: { nextTool: response.answers.nextTool } }),
  );
  const config = parseConfig({ provider: "openrouter" });
  const router = createJevRouter(createDecisionModel(config, "test-key"), config);

  await expect(router.evaluate(state, tools)).rejects.toThrow();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});
