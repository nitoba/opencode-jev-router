import { z } from "zod";
import type { RouterConfig } from "./types.ts";

const probability = z.number().finite().min(0).max(1);
const modelOptions = z.record(z.string().min(1), z.record(z.string().min(1), z.unknown()));

const optionsSchema = z
  .object({
    mode: z.enum(["observe", "shortlist", "strict"]).default("shortlist"),
    apiKeyEnv: z.string().min(1).default("TYPESAFE_API_KEY"),
    model: z.string().min(1).default("jev-latest"),
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
    if (value.softThreshold > value.hardThreshold) {
      context.addIssue({
        code: "custom",
        path: ["softThreshold"],
        message: "softThreshold must be less than or equal to hardThreshold",
      });
    }
  });

export type PluginOptions = z.input<typeof optionsSchema>;

export const DEFAULT_CONFIG = Object.freeze({
  mode: "shortlist",
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
} satisfies Omit<RouterConfig, "baseURL">);

export function parseConfig(input: unknown): RouterConfig {
  const parsed = optionsSchema.parse(input ?? {});
  return {
    mode: parsed.mode,
    apiKeyEnv: parsed.apiKeyEnv,
    model: parsed.model,
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
