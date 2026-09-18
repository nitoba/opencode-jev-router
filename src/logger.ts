import type { RoutingTrace } from "./types.ts";

export interface RouterLogger {
  debug(trace: RoutingTrace): void;
  warnOnce(key: string, message: string): void;
}

export function createLogger(enabled: boolean): RouterLogger {
  const warned = new Set<string>();

  return {
    debug(trace) {
      if (!enabled) return;
      console.info("[opencode-jev-router]", JSON.stringify(trace));
    },
    warnOnce(key, message) {
      if (warned.has(key)) return;
      warned.add(key);
      console.warn(`[opencode-jev-router] ${message}`);
    },
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown routing error";
}
