import { Plugin } from "@opencode/plugin";
import { ProviderError } from "@nitoba/questions";
import { parseConfig } from "./config.ts";
import { createLogger, errorMessage } from "./logger.ts";
import { createRoutingPlan } from "./policy.ts";
import { createDecisionModel } from "./provider.ts";
import { RateLimitCircuitBreaker } from "./rate-limit.ts";
import { createJevRouter, RouterCapacityError } from "./router.ts";
import { buildRouterState } from "./state.ts";
import { clearTools, keepOnlyTools, mergeModelOptions, toolCriteriaChars } from "./tools.ts";
import type { RoutingInputMetrics, RoutingTrace, ToolCatalog } from "./types.ts";

function readEnvironment(name: string): string | undefined {
  const host = globalThis as typeof globalThis & {
    readonly process?: { readonly env?: Readonly<Record<string, string | undefined>> };
  };
  return host.process?.env?.[name];
}

function isRateLimitError(error: unknown): error is ProviderError {
  return error instanceof ProviderError && error.status === 429;
}

function routingTrace(
  event: {
    readonly sessionID: string;
    readonly agent: string;
    readonly model: { readonly providerID: string; readonly id: string };
  },
  mode: "observe" | "shortlist" | "strict",
  catalogSize: number,
  reason: string,
): RoutingTrace {
  return {
    sessionID: event.sessionID,
    agent: event.agent,
    providerID: event.model.providerID,
    modelID: event.model.id,
    mode,
    catalogSize,
    reason,
  };
}

function inputMetrics(
  state: {
    readonly user_request: string;
    readonly prior_user_messages: readonly string[];
    readonly actions_taken: readonly unknown[];
    readonly assistant_said: readonly string[];
  },
  tools: ToolCatalog,
  maxToolDescriptionChars: number,
): RoutingInputMetrics {
  return {
    stateChars: JSON.stringify(state).length,
    toolCriteriaChars: toolCriteriaChars(tools, maxToolDescriptionChars),
    actionsCount: state.actions_taken.length,
    userMessagesCount: state.prior_user_messages.length + (state.user_request.length === 0 ? 0 : 1),
    assistantMessagesCount: state.assistant_said.length,
  };
}

function withTokenDensity(
  metrics: RoutingInputMetrics,
  inputTokens: number | undefined,
  catalogSize: number,
): RoutingInputMetrics {
  if (inputTokens === undefined || catalogSize === 0) return metrics;
  return {
    ...metrics,
    inputTokensPerTool: Math.round((inputTokens / catalogSize) * 100) / 100,
  };
}

export default Plugin.define({
  id: "opencode-jev-router",

  async setup(ctx) {
    const config = parseConfig(ctx.options);
    const logger = createLogger(config.debug, ctx.location.directory);
    const apiKey =
      config.apiKey ?? (config.apiKeyEnv ? readEnvironment(config.apiKeyEnv) : undefined);
    const credentialSource = config.apiKey === undefined ? "environment" : "inline";

    logger.event("plugin.loaded", {
      provider: config.provider,
      model: config.model,
      mode: config.mode,
      credentialSource,
      ...(logger.file === undefined ? {} : { logFile: logger.file }),
    });

    if (!apiKey) {
      logger.warnOnce(
        "missing-api-key",
        "Provider credentials are unavailable; Jev routing is disabled and OpenCode will keep its normal tool selection.",
      );
      return;
    }

    const model = createDecisionModel(config, apiKey);
    const router = createJevRouter(model, config);
    const rateLimit = new RateLimitCircuitBreaker();

    const registration = await ctx.session.hook("context", async (event) => {
      const catalogSize = Object.keys(event.tools).length;
      if (catalogSize < config.minTools) {
        logger.debug(routingTrace(event, config.mode, catalogSize, "too-few-tools"));
        return;
      }

      const attempt = rateLimit.attempt();
      if (!attempt.allowed) return;

      if (attempt.probe) {
        logger.event("router.rate_limit.probe", {
          sessionID: event.sessionID,
          provider: config.provider,
          model: config.model,
        });
      }

      const tools = event.tools satisfies ToolCatalog;
      const state = buildRouterState(event.messages);

      try {
        const metrics = inputMetrics(state, tools, config.maxToolDescriptionChars);
        logger.event("jev.request.started", {
          sessionID: event.sessionID,
          catalogSize,
          provider: config.provider,
          model: config.model,
          ...metrics,
        });

        const evaluation = await router.evaluate(state, tools);
        const recovered = rateLimit.succeeded();
        if (recovered) {
          logger.event("router.rate_limit.recovered", {
            sessionID: event.sessionID,
            provider: config.provider,
            model: config.model,
            ...recovered,
          });
        }

        const measured = withTokenDensity(metrics, evaluation.usage.inputTokens, catalogSize);
        const plan = createRoutingPlan(evaluation, Object.keys(event.tools), config);
        const trace: RoutingTrace = {
          ...routingTrace(event, config.mode, catalogSize, plan.reason),
          ...(plan.kind === "fallback" ? {} : { selected: plan.selected }),
          ...(plan.kind === "tools" ? { exposedTools: plan.tools } : {}),
          confidence: evaluation.nextTool.confidence,
          ...(evaluation.nextTool.confidenceSource === undefined
            ? {}
            : { confidenceSource: evaluation.nextTool.confidenceSource }),
          ...(evaluation.nextTool.probabilitySource === undefined
            ? {}
            : { probabilitySource: evaluation.nextTool.probabilitySource }),
          doneProbability: evaluation.done.probability,
          latencyMs: evaluation.latencyMs,
          calls: evaluation.calls,
          usage: evaluation.usage,
          ...measured,
          ...(evaluation.selectedFamily === undefined
            ? {}
            : { selectedFamily: evaluation.selectedFamily }),
        };

        logger.event("jev.request.completed", {
          sessionID: event.sessionID,
          latencyMs: evaluation.latencyMs,
          calls: evaluation.calls,
          confidence: evaluation.nextTool.confidence,
          doneProbability: evaluation.done.probability,
          ...(evaluation.usage.inputTokens === undefined
            ? {}
            : { inputTokens: evaluation.usage.inputTokens }),
          ...(evaluation.usage.outputTokens === undefined
            ? {}
            : { outputTokens: evaluation.usage.outputTokens }),
          ...measured,
        });
        logger.debug(trace);

        if (config.mode === "observe" || plan.kind === "fallback") return;

        if (plan.kind === "respond") {
          clearTools(event.tools);
          event.system.push({
            type: "text",
            text: "No further tool call is needed for this step. Answer the user from the completed work and available results.",
          });
          logger.event("router.applied", {
            sessionID: event.sessionID,
            action: "respond",
          });
          return;
        }

        keepOnlyTools(event.tools, plan.tools);
        mergeModelOptions(event.options, config.modelOptions[event.model.providerID]);
        logger.event("router.applied", {
          sessionID: event.sessionID,
          action: "tools",
          exposedTools: plan.tools,
        });
      } catch (error) {
        if (error instanceof RouterCapacityError) {
          if (attempt.probe) rateLimit.failedProbe();
          logger.debug(routingTrace(event, config.mode, catalogSize, "catalog-too-large"));
          return;
        }

        const message = errorMessage(error);
        logger.event("jev.request.failed", {
          sessionID: event.sessionID,
          error: message,
        });

        if (isRateLimitError(error)) {
          const opened = rateLimit.rateLimited();
          logger.event("router.rate_limit", {
            sessionID: event.sessionID,
            provider: config.provider,
            model: config.model,
            status: error.status,
            ...opened,
          });
          logger.warnOnce(
            `rate-limit:${opened.consecutiveRateLimits}`,
            `Jev rate limited the router; routing is paused for ${Math.round(opened.cooldownMs / 1_000)}s and OpenCode will keep its normal tool selection.`,
          );
          return;
        }

        if (attempt.probe) rateLimit.failedProbe();

        logger.warnOnce(
          `routing:${message}`,
          `Jev routing failed; falling back to OpenCode's normal tool selection. ${message}`,
        );
      }
    });

    return () => registration.dispose();
  },
});
