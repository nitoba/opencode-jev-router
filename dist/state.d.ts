import type { RouterState } from "./types.ts";
/**
 * Convert OpenCode's assembled LLM messages into a small operational state for semantic routing.
 * Only recent user intent, assistant progress and completed tool outcomes are retained.
 * Reasoning, media, provider metadata and raw binary content are intentionally excluded.
 */
export declare function buildRouterState(messages: readonly unknown[]): RouterState;
//# sourceMappingURL=state.d.ts.map