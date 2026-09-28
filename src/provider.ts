import { Duration, TypeSafe, type QuestionModel } from "@nitoba/questions";
import * as SystemOne from "@nitoba/questions/providers/system-one";
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
  if (config.provider === "openrouter") {
    return SystemOne.create({
      ...common,
      name: "OpenRouter",
      baseURL: config.baseURL ?? "https://openrouter.ai/api/v1",
    });
  }
  return TypeSafe.create(common);
}
