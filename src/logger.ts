import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RoutingTrace } from "./types.ts";

export interface RouterLogger {
  readonly file?: string;
  event(name: string, data?: Readonly<Record<string, unknown>>): void;
  debug(trace: RoutingTrace): void;
  warnOnce(key: string, message: string): void;
}

export function createLogger(enabled: boolean, directory: string): RouterLogger {
  const warned = new Set<string>();
  const file = enabled ? join(directory, ".opencode", "opencode-jev-router.log") : undefined;

  if (file) {
    try {
      mkdirSync(join(directory, ".opencode"), { recursive: true });
    } catch {
      // Logging must never affect routing.
    }
  }

  const write = (event: string, data: Readonly<Record<string, unknown>> = {}) => {
    if (!enabled) return;
    const record = { timestamp: new Date().toISOString(), event, ...data };
    const line = JSON.stringify(record);
    console.info("[opencode-jev-router]", line);
    if (!file) return;
    try {
      appendFileSync(file, `${line}\n`, "utf8");
    } catch {
      // Debug logging is best-effort and must never break the agent loop.
    }
  };

  return {
    ...(file === undefined ? {} : { file }),
    event: write,
    debug(trace) {
      write("router.decision", { ...trace });
    },
    warnOnce(key, message) {
      if (warned.has(key)) return;
      warned.add(key);
      console.warn(`[opencode-jev-router] ${message}`);
      write("router.warning", { message });
    },
  };
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return "Unknown routing error";
}
