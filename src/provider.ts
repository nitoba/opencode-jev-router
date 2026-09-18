import { Duration, TypeSafe, type QuestionModel } from "@nitoba/questions";
import * as Vercel from "@nitoba/questions/providers/vercel";
import type { RouterConfig } from "./types.ts";

export function createDecisionModel(config: RouterConfig, apiKey: string): QuestionModel {
  const common = {
    apiKey,
    model: config.model,
    ...(config.baseURL === undefined ? {} : { baseURL: config.baseURL }),
    timeout: Duration.parse(config.timeout),
    retry: config.retry,
  };

  if (config.provider === "vercel") return Vercel.create(common);
  return TypeSafe.create(common);
}
