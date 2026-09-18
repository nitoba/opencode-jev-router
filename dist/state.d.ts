import type { RouterState } from "./types.ts";
/**
 * Convert OpenCode's assembled LLM messages into compact JSON state for semantic routing.
 * Reasoning, media, provider metadata and raw binary content are intentionally excluded.
 */
export declare function buildRouterState(messages: readonly unknown[]): RouterState;
//# sourceMappingURL=state.d.ts.map