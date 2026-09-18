import type { RouterConfig, RoutingEvaluation, RoutingPlan } from "./types.ts";
import { RESPOND_TO_USER } from "./types.ts";

export function createRoutingPlan(
  evaluation: RoutingEvaluation,
  availableTools: readonly string[],
  config: RouterConfig,
): RoutingPlan {
  const available = new Set(availableTools);
  const confidence = evaluation.nextTool.confidence;
  const doneProbability = evaluation.done.probability;
  let selected = evaluation.nextTool.choice;

  if (selected === RESPOND_TO_USER) {
    if (doneProbability >= config.doneThreshold) {
      return {
        kind: "respond",
        selected: RESPOND_TO_USER,
        confidence,
        doneProbability,
        reason: "done",
      };
    }

    selected =
      evaluation.ranked.find(({ name }) => name !== RESPOND_TO_USER && available.has(name))?.name ??
      "";
  }

  if (!selected || !available.has(selected)) {
    return {
      kind: "fallback",
      confidence,
      doneProbability,
      reason: "no-tool-candidate",
    };
  }

  if (config.mode === "strict") {
    return {
      kind: "tools",
      selected,
      tools: [selected],
      confidence,
      doneProbability,
      reason: "strict",
    };
  }

  if (confidence >= config.hardThreshold) {
    return {
      kind: "tools",
      selected,
      tools: [selected],
      confidence,
      doneProbability,
      reason: "high-confidence",
    };
  }

  if (confidence >= config.softThreshold) {
    const tools = evaluation.ranked
      .filter(({ name }) => name !== RESPOND_TO_USER && available.has(name))
      .slice(0, config.topK)
      .map(({ name }) => name);

    if (!tools.includes(selected)) tools.unshift(selected);

    return {
      kind: "tools",
      selected,
      tools: tools.slice(0, config.topK),
      confidence,
      doneProbability,
      reason: "shortlist",
    };
  }

  return {
    kind: "fallback",
    confidence,
    doneProbability,
    reason: "low-confidence",
  };
}
