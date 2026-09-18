import { Plugin } from "@opencode/plugin";
import { parseConfig } from "./config.ts";
import { createLogger, errorMessage } from "./logger.ts";
import { createRoutingPlan } from "./policy.ts";
import { createDecisionModel } from "./provider.ts";
import { createJevRouter, RouterCapacityError } from "./router.ts";
import { buildRouterState } from "./state.ts";
import { clearTools, keepOnlyTools, mergeModelOptions } from "./tools.ts";
import type { RoutingTrace, ToolCatalog } from "./types.ts";

function readEnvironment(name: string): string | undefined {
  const host = globalThis as typeof globalThis & {
    readonly process?: { readonly env?: Readonly<Record<string, string | undefined>> };
  };
  return host.process?.env?.[name];
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

export default Plugin.define({
  id: "opencode-jev-router",

  async setup(ctx) {
    const config = parseConfig(ctx.options);
    const logger = createLogger(config.debug, ctx.location.directory);
    const apiKey = readEnvironment(config.apiKeyEnv);

    logger.event("plugin.loaded", {
      provider: config.provider,
      model: config.model,
      mode: config.mode,
      apiKeyEnv: config.apiKeyEnv,
      ...(logger.file === undefined ? {} : { logFile: logger.file }),
    });

    if (!apiKey) {
      logger.warnOnce(
        "missing-api-key",
        `${config.apiKeyEnv} is not set; Jev routing is disabled and OpenCode will keep its normal tool selection.`,
      );
      return;
    }

    const model = createDecisionModel(config, apiKey);
    const router = createJevRouter(model, config);

    const registration = await ctx.session.hook("context", async (event) => {
      const catalogSize = Object.keys(event.tools).length;
      if (catalogSize < config.minTools) {
        logger.debug(routingTrace(event, config.mode, catalogSize, "too-few-tools"));
        return;
      }

      const tools = event.tools satisfies ToolCatalog;
      const state = buildRouterState(event.messages);

      logger.event("jev.request.started", {
        sessionID: event.sessionID,
        catalogSize,
        provider: config.provider,
        model: config.model,
      });

      try {
        const evaluation = await router.evaluate(state, tools);
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
          logger.debug(routingTrace(event, config.mode, catalogSize, "catalog-too-large"));
          return;
        }

        const message = errorMessage(error);
        logger.event("jev.request.failed", {
          sessionID: event.sessionID,
          error: message,
        });
        logger.warnOnce(
          `routing:${message}`,
          `Jev routing failed; falling back to OpenCode's normal tool selection. ${message}`,
        );
      }
    });

    return () => registration.dispose();
  },
});
