import { z } from "zod";
import type { RouterConfig } from "./types.ts";

const probability = z.number().finite().min(0).max(1);
const modelOptions = z.record(z.string().min(1), z.record(z.string().min(1), z.unknown()));
const environmentVariable = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "apiKeyEnv must be an environment variable name, not the API key value",
  );

const optionsSchema = z
  .object({
    mode: z.enum(["observe", "shortlist", "strict"]).default("shortlist"),
    provider: z.enum(["typesafe", "vercel"]).default("typesafe"),
    apiKey: z.string().min(1).optional(),
    apiKeyEnv: environmentVariable.optional(),
    model: z.string().min(1).optional(),
    baseURL: z.string().url().optional(),
    timeout: z.union([z.string().min(1), z.number().int().positive()]).default("2 seconds"),
    retry: z.union([z.literal(false), z.number().int().min(0).max(10)]).default(false),
    hardThreshold: probability.default(0.8),
    softThreshold: probability.default(0.55),
    doneThreshold: probability.default(0.7),
    topK: z.number().int().min(1).max(254).default(3),
    minTools: z.number().int().min(1).default(2),
    maxToolDescriptionChars: z.number().int().min(160).max(4_000).default(900),
    debug: z.boolean().default(false),
    modelOptions: modelOptions.default({}),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.apiKey !== undefined && value.apiKeyEnv !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "Use either apiKey or apiKeyEnv, not both",
      });
    }

    if (value.softThreshold > value.hardThreshold) {
      context.addIssue({
        code: "custom",
        path: ["softThreshold"],
        message: "softThreshold must be less than or equal to hardThreshold",
      });
    }

    if (!value.baseURL) return;

    const url = new URL(value.baseURL);
    if (value.provider === "typesafe" && url.hostname === "ai-gateway.vercel.sh") {
      context.addIssue({
        code: "custom",
        path: ["baseURL"],
        message:
          'Vercel AI Gateway is not a System One endpoint. Use provider: "vercel" instead of "typesafe".',
      });
    }

    if (
      value.provider === "vercel" &&
      url.hostname === "ai-gateway.vercel.sh" &&
      /^\/v1\/?$/.test(url.pathname)
    ) {
      context.addIssue({
        code: "custom",
        path: ["baseURL"],
        message:
          'The Vercel Jev provider uses the Evaluation V4 endpoint, not the OpenAI-compatible /v1 endpoint. Omit baseURL or use "https://ai-gateway.vercel.sh/v4/ai".',
      });
    }
  });

export type PluginOptions = z.input<typeof optionsSchema>;

export const DEFAULT_CONFIG = Object.freeze({
  mode: "shortlist",
  provider: "typesafe",
  apiKeyEnv: "TYPESAFE_API_KEY",
  model: "jev-latest",
  timeout: "2 seconds",
  retry: false,
  hardThreshold: 0.8,
  softThreshold: 0.55,
  doneThreshold: 0.7,
  topK: 3,
  minTools: 2,
  maxToolDescriptionChars: 900,
  debug: false,
  modelOptions: {},
} satisfies Omit<RouterConfig, "apiKey" | "baseURL">);

export function parseConfig(input: unknown): RouterConfig {
  const parsed = optionsSchema.parse(input ?? {});
  const defaultApiKeyEnv =
    parsed.provider === "vercel" ? "AI_GATEWAY_API_KEY" : "TYPESAFE_API_KEY";
  const model = parsed.model ?? (parsed.provider === "vercel" ? "typesafe-ai/jev" : "jev-latest");

  return {
    mode: parsed.mode,
    provider: parsed.provider,
    ...(parsed.apiKey === undefined ? {} : { apiKey: parsed.apiKey }),
    ...(parsed.apiKey !== undefined
      ? {}
      : { apiKeyEnv: parsed.apiKeyEnv ?? defaultApiKeyEnv }),
    model,
    ...(parsed.baseURL === undefined ? {} : { baseURL: parsed.baseURL }),
    timeout: parsed.timeout,
    retry: parsed.retry,
    hardThreshold: parsed.hardThreshold,
    softThreshold: parsed.softThreshold,
    doneThreshold: parsed.doneThreshold,
    topK: parsed.topK,
    minTools: parsed.minTools,
    maxToolDescriptionChars: parsed.maxToolDescriptionChars,
    debug: parsed.debug,
    modelOptions: parsed.modelOptions,
  };
}
