import type { RouterAction, RouterState } from "./types.ts";

const MAX_USER_MESSAGES = 4;
const MAX_ASSISTANT_MESSAGES = 8;
const MAX_ACTIONS = 32;
const MAX_TEXT_CHARS = 1_200;
const MAX_RESULT_CHARS = 1_600;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 14))}…[truncated]`;
}

function printable(value: unknown, max: number): string {
  if (typeof value === "string") return clip(value, max);
  try {
    return clip(JSON.stringify(value) ?? String(value), max);
  } catch {
    return clip(String(value), max);
  }
}

function textParts(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!isRecord(part) || part.type !== "text" || typeof part.text !== "string") return [];
      return [part.text];
    })
    .join("\n")
    .trim();
}

function toolResultValue(result: unknown): { readonly status: RouterAction["status"]; readonly value: unknown } {
  if (!isRecord(result)) return { status: "completed", value: result };
  return {
    status: result.type === "error" ? "error" : "completed",
    value: "value" in result ? result.value : result,
  };
}

/**
 * Convert OpenCode's assembled LLM messages into compact JSON state for semantic routing.
 * Reasoning, media, provider metadata and raw binary content are intentionally excluded.
 */
export function buildRouterState(messages: readonly unknown[]): RouterState {
  const userMessages: string[] = [];
  const assistantMessages: string[] = [];
  const actions: RouterAction[] = [];
  const pending = new Map<string, Omit<RouterAction, "result" | "status">>();
  let step = 0;

  for (const message of messages) {
    if (!isRecord(message) || typeof message.role !== "string") continue;
    const content = message.content;

    if (message.role === "user") {
      const text = textParts(content);
      if (text) userMessages.push(clip(text, MAX_TEXT_CHARS));
      continue;
    }

    if (message.role === "assistant") {
      const text = textParts(content);
      if (text) assistantMessages.push(clip(text, MAX_TEXT_CHARS));
      if (!Array.isArray(content)) continue;

      for (const part of content) {
        if (
          !isRecord(part) ||
          part.type !== "tool-call" ||
          typeof part.id !== "string" ||
          typeof part.name !== "string"
        ) {
          continue;
        }

        step += 1;
        pending.set(part.id, {
          step,
          tool: part.name,
          input: printable(part.input, MAX_RESULT_CHARS),
        });
      }
      continue;
    }

    if (message.role !== "tool" || !Array.isArray(content)) continue;

    for (const part of content) {
      if (
        !isRecord(part) ||
        part.type !== "tool-result" ||
        typeof part.id !== "string" ||
        typeof part.name !== "string"
      ) {
        continue;
      }

      const call = pending.get(part.id) ?? {
        step: ++step,
        tool: part.name,
        input: "",
      };
      const result = toolResultValue(part.result);
      actions.push({
        ...call,
        status: result.status,
        result: printable(result.value, MAX_RESULT_CHARS),
      });
      pending.delete(part.id);
    }
  }

  const recentUsers = userMessages.slice(-MAX_USER_MESSAGES);
  return {
    user_request: recentUsers.at(-1) ?? "",
    prior_user_messages: recentUsers.slice(0, -1),
    actions_taken: actions.slice(-MAX_ACTIONS),
    assistant_said: assistantMessages.slice(-MAX_ASSISTANT_MESSAGES),
  };
}
